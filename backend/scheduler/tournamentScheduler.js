const { Op } = require('sequelize');

// NOTE: app.database.engine - see the sibling chunk's db/sequelize.js. The
// scheduler's Python version creates its own sessionmaker bound to the
// shared engine; Sequelize models are already bound to a single shared
// connection instance, so there's no separate "session factory" step needed
// here - each query just uses the models directly.
const { Tournament, TournamentRegistration } = require('../models/tournament');
const TournamentTicket = require('../models/ticket');
const { TournamentState, TournamentStake } = require('../models/enums');

const { _startTournament, balanceTables, calculatePayouts } = require('../services/tournamentService');

const TICK_SECONDS = 1;

// ---------------------------------------------------------
// MAIN SCHEDULER LOOP
// ---------------------------------------------------------
async function tournamentSchedulerLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const now = new Date();

      const tournaments = await Tournament.findAll({
        where: {
          state: {
            [Op.in]: [TournamentState.WAITING, TournamentState.RUNNING, TournamentState.BREAK],
          },
        },
        include: ['registrations', 'tables'],
      });

      for (const t of tournaments) {
        // eslint-disable-next-line no-await-in-loop
        await _processTournament(t, now);
      }
    } catch (e) {
      // TODO: replace with real logging
      console.log('Scheduler error:', e);
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, TICK_SECONDS * 1000);
    });
  }
}

// ---------------------------------------------------------
// PROCESS A SINGLE TOURNAMENT
// ---------------------------------------------------------
async function _processTournament(t, now) {
  const regsCount = (t.registrations || []).length;

  // START TOURNAMENT
  if (t.state === TournamentState.WAITING) {
    if (regsCount >= 2) {
      await _startTournament(t, now);
    }
    return;
  }

  // LEVEL ADVANCEMENT
  if (t.level_end_time && now >= new Date(t.level_end_time)) {
    t.current_level += 1;
    t.level_start_time = now;
    t.level_end_time = new Date(now.getTime() + t.level_duration_minutes * 60 * 1000);
    await t.save();
  }

  // TABLE BALANCING
  await balanceTables(t);

  // CHECK FOR FINISH
  const remaining = await TournamentRegistration.count({
    where: { tournament_id: t.id, eliminated: false },
  });

  if (remaining === 1 && t.state !== TournamentState.FINISHED) {
    await _finishTournament(t);
  }
}

// ---------------------------------------------------------
// FINISH TOURNAMENT
// ---------------------------------------------------------
async function _finishTournament(t) {
  t.state = TournamentState.FINISHED;
  t.finished_at = new Date();

  await calculatePayouts(t, null);

  if (t.is_freeroll) {
    await _awardMicroTicket(t);
  }

  await t.save();
}

// ---------------------------------------------------------
// AWARD MICRO TICKET TO WINNER (FREEROLL ONLY)
// ---------------------------------------------------------
async function _awardMicroTicket(t) {
  const winner = await TournamentRegistration.findOne({
    where: { tournament_id: t.id, elimination_position: 1 },
  });

  if (!winner) return;

  await TournamentTicket.create({
    user_id: winner.user_id,
    stake: TournamentStake.MICRO,
    created_at: new Date(),
    used: false,
  });
}

module.exports = { tournamentSchedulerLoop };
