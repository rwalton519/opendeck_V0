// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * OpenDeckPoker.sol
 * ------------------
 * Polygon / native-USDC pooled bankroll + rake-extraction contract for
 * opendeck.ca cash-game tables.
 *
 * DESIGN SUMMARY
 * --------------
 * - Players fund a per-table pooled balance with USDC (fundTable), which
 *   the backend then treats as an additional chip-balance source for that
 *   player's seat (see services/game/buyinManager.js's cashgameRebuyOnChain
 *   and services/blockchain/onchainRakeService.js on the Node side).
 * - Actual poker (dealing, betting, showdown) happens off-chain in
 *   liveHandEngine.js, exactly as it does for fiat/chip play - this
 *   contract never sees individual streets or actions. It only sees two
 *   things: money coming IN (fundTable) and the NET RESULT of a hand that
 *   involved on-chain-backed chips going OUT (operatorSettleHand).
 * - Rake is extracted only for hands that satisfy both conditions in the
 *   product spec: the hand reached the flop, AND at least one bet/raise
 *   occurred. That gating is enforced off-chain in liveHandEngine.js
 *   (sawFlop / hadBet flags) BEFORE this contract is ever called - this
 *   contract has no visibility into hand streets, so it cannot re-derive
 *   or double-check that condition itself. It only trusts the operator's
 *   signed instruction for the USDC-denominated slice of an already-gated
 *   hand. The 5%-of-pot math and on-chain/fiat apportionment also happen
 *   off-chain (onchainRakeService.js) - this contract just executes the
 *   resulting balance deltas + rake transfer atomically and permanently
 *   records that this exact hand can never be settled on-chain again.
 * - Withdrawals are player-initiated but blocked while the operator has
 *   marked that player's table balance as "seated" (i.e. actively backing
 *   a live seat), so a player can't out-run their side of an in-progress
 *   hand's settlement. The backend sets/clears this via
 *   setSeatedForWithdrawal() when the player takes/leaves a seat funded
 *   from their on-chain balance.
 *
 * TRUST MODEL / WHAT THIS DOES *NOT* PROTECT AGAINST
 * ----------------------------------------------------
 * The `operator` address is a hot wallet controlled by the OpenDeck
 * backend (see services/blockchain/chainConfig.js). operatorSettleHand and
 * setSeatedForWithdrawal are only as trustworthy as that private key's
 * custody. This contract enforces that the operator can never invent money
 * (settlement deltas + rake must net to exactly zero against the pooled
 * balances actually on the table - see the sum-check in
 * operatorSettleHand), and that any single hand can only ever be settled
 * once (replay guard), but it CANNOT verify that the deltas the operator
 * submits actually match what really happened at the poker table - that
 * guarantee comes entirely from the off-chain provably-fair RNG engine and
 * the operator's own bookkeeping, not from this contract. A compromised or
 * malicious operator key can still misallocate funds among players who
 * already have money pooled on this contract, and a compromised `owner`
 * key can rotate the operator/rake recipient to any address. In other
 * words: this contract removes custody of *un-deposited* funds from
 * OpenDeck (players self-custody until they choose to fundTable, and can
 * always withdraw an un-seated balance without asking anyone), but it does
 * NOT make the operator itself trustless. Treat the operator key with the
 * same care as a exchange hot wallet, use a multisig/hardware-backed
 * signer for `owner`, and get an independent audit before moving real
 * funds - none of that is provided by this file.
 *
 * NOT YET DONE / FLAGGED HONESTLY
 * --------------------------------
 * - This file has been compiled locally with solc 0.8.24 (see
 *   contracts/README.md for the exact command and output) - it is
 *   syntactically valid and its ABI has been mechanically extracted, not
 *   hand-typed. It has NOT been through a security audit, has NOT been
 *   deployed to any network (mainnet or testnet), and has NOT been tested
 *   against a real USDC contract or a running instance of Hardhat's test
 *   network in this environment (network egress here doesn't reach
 *   Polygon RPCs or a local chain fork). Do not point real funds at it
 *   without: (1) an independent audit, (2) full unit + fork-mode test
 *   coverage against real Polygon USDC, (3) a testnet dry run.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract OpenDeckPoker {
    // ------------------------------------------------------------------
    // Roles
    // ------------------------------------------------------------------

    address public owner;
    address public operator;      // OpenDeck backend's signing hot wallet
    address public rakeRecipient; // where extracted rake USDC accumulates

    IERC20 public immutable usdc;

    bool public paused;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    // tableId => player => pooled USDC balance (6-decimal USDC base units)
    mapping(uint256 => mapping(address => uint256)) public tableBalances;

    // tableId => player => currently backing a live seat (blocks withdrawal)
    mapping(uint256 => mapping(address => bool)) public seated;

    // handId => already settled on-chain (replay guard)
    mapping(bytes32 => bool) public settledHands;

    uint256 private _reentrancyLock = 1;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event Funded(uint256 indexed tableId, address indexed player, uint256 amount);
    event WithdrawnFromTable(uint256 indexed tableId, address indexed player, uint256 amount);
    event SeatedStatusSet(uint256 indexed tableId, address indexed player, bool seatedStatus);
    event HandSettled(uint256 indexed tableId, bytes32 indexed handId, uint256 rakeAmount, uint256 playerCount);
    event PlayerDelta(uint256 indexed tableId, bytes32 indexed handId, address indexed player, int256 delta);
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);
    event RakeRecipientChanged(address indexed previousRecipient, address indexed newRecipient);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);
    event Paused(bool isPaused);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "OpenDeckPoker: caller is not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "OpenDeckPoker: caller is not operator");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "OpenDeckPoker: contract is paused");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyLock == 1, "OpenDeckPoker: reentrant call");
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    constructor(address usdcAddress, address operatorAddress, address rakeRecipientAddress) {
        require(usdcAddress != address(0), "OpenDeckPoker: usdc address is zero");
        require(operatorAddress != address(0), "OpenDeckPoker: operator address is zero");
        require(rakeRecipientAddress != address(0), "OpenDeckPoker: rake recipient is zero");

        owner = msg.sender;
        usdc = IERC20(usdcAddress);
        operator = operatorAddress;
        rakeRecipient = rakeRecipientAddress;
    }

    // ------------------------------------------------------------------
    // Player-facing: funding and withdrawal
    // ------------------------------------------------------------------

    /**
     * Fund a table's pooled bankroll for msg.sender. Caller must have
     * already called usdc.approve(address(this), amount). This is what
     * backs a "Rebuy with USDC" action on the frontend - the backend
     * verifies this event on-chain (via onchainRakeService.js) before
     * crediting the player's off-chain seat stack.
     */
    function fundTable(uint256 tableId, uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "OpenDeckPoker: amount must be positive");
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "OpenDeckPoker: USDC transferFrom failed");

        tableBalances[tableId][msg.sender] += amount;
        emit Funded(tableId, msg.sender, amount);
    }

    /**
     * Withdraw an un-seated portion of a player's pooled table balance.
     * Blocked while `seated[tableId][msg.sender]` is true (i.e. this
     * balance is currently backing a live seat) - see setSeatedForWithdrawal.
     */
    function withdrawFromTable(uint256 tableId, uint256 amount) external whenNotPaused nonReentrant {
        require(!seated[tableId][msg.sender], "OpenDeckPoker: balance is currently seated");
        uint256 bal = tableBalances[tableId][msg.sender];
        require(amount > 0 && amount <= bal, "OpenDeckPoker: insufficient table balance");

        tableBalances[tableId][msg.sender] = bal - amount;
        bool ok = usdc.transfer(msg.sender, amount);
        require(ok, "OpenDeckPoker: USDC transfer failed");

        emit WithdrawnFromTable(tableId, msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Operator-facing: seat locking and hand settlement
    // ------------------------------------------------------------------

    /**
     * Marks whether `player`'s on-chain balance at `tableId` is currently
     * backing a live seat. Called by the backend when a player takes a
     * seat funded (in whole or part) from their on-chain balance, and
     * cleared when they leave/cash out. Purely a withdrawal gate - does
     * not move funds.
     */
    function setSeatedForWithdrawal(uint256 tableId, address player, bool seatedStatus) external onlyOperator {
        seated[tableId][player] = seatedStatus;
        emit SeatedStatusSet(tableId, player, seatedStatus);
    }

    /**
     * Apply the net result of one settled hand to every on-chain-backed
     * player who was involved, and sweep the USDC-denominated rake slice
     * to rakeRecipient - all atomically, all-or-nothing.
     *
     * `handId` should be a deterministic hash of (tableId, hand number)
     * computed off-chain (see onchainRakeService.js) so the same hand can
     * never be submitted twice (replay guard via settledHands).
     *
     * `deltas` are signed: positive for a net winner, negative for a net
     * loser, ALREADY NET OF that player's share of the rake (i.e. the
     * off-chain settlement engine has already worked out who owes what,
     * same as settlementManager.js does for the fiat/chip side - see that
     * file's per-hand rake accounting). This function only requires that
     * every delta fits inside the player's existing pooled balance and
     * that the whole hand nets to exactly `-int256(rakeAmount)`, i.e. no
     * money is created or destroyed - it never trusts the *content* of the
     * deltas as poker-accurate, only that they balance.
     */
    function operatorSettleHand(
        uint256 tableId,
        bytes32 handId,
        address[] calldata players,
        int256[] calldata deltas,
        uint256 rakeAmount
    ) external onlyOperator nonReentrant {
        require(players.length == deltas.length, "OpenDeckPoker: players/deltas length mismatch");
        require(players.length > 0, "OpenDeckPoker: no players in settlement");
        require(!settledHands[handId], "OpenDeckPoker: hand already settled");
        settledHands[handId] = true;

        int256 sumDeltas = 0;
        for (uint256 i = 0; i < players.length; i++) {
            address player = players[i];
            int256 delta = deltas[i];
            sumDeltas += delta;

            uint256 bal = tableBalances[tableId][player];
            if (delta >= 0) {
                tableBalances[tableId][player] = bal + uint256(delta);
            } else {
                uint256 absDelta = uint256(-delta);
                require(absDelta <= bal, "OpenDeckPoker: delta exceeds player's table balance");
                tableBalances[tableId][player] = bal - absDelta;
            }
            emit PlayerDelta(tableId, handId, player, delta);
        }

        // Conservation check: every USDC unit that left a loser's balance
        // must land either in a winner's balance or in the rake sweep -
        // nothing else. This is the contract's core safety property.
        require(sumDeltas == -int256(rakeAmount), "OpenDeckPoker: deltas + rake do not net to zero");

        if (rakeAmount > 0) {
            bool ok = usdc.transfer(rakeRecipient, rakeAmount);
            require(ok, "OpenDeckPoker: rake transfer failed");
        }

        emit HandSettled(tableId, handId, rakeAmount, players.length);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "OpenDeckPoker: operator address is zero");
        emit OperatorChanged(operator, newOperator);
        operator = newOperator;
    }

    function setRakeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "OpenDeckPoker: recipient address is zero");
        emit RakeRecipientChanged(rakeRecipient, newRecipient);
        rakeRecipient = newRecipient;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OpenDeckPoker: owner address is zero");
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }

    function setPaused(bool isPaused) external onlyOwner {
        paused = isPaused;
        emit Paused(isPaused);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function balanceOf(uint256 tableId, address player) external view returns (uint256) {
        return tableBalances[tableId][player];
    }

    function isSeated(uint256 tableId, address player) external view returns (bool) {
        return seated[tableId][player];
    }

    function isHandSettled(bytes32 handId) external view returns (bool) {
        return settledHands[handId];
    }
}
