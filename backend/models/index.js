// Converted from models/__init__.py. The Python version's comment explains
// its purpose: explicit re-exports so importing `app.models` registers every
// ORM class with the shared Base metadata (needed for Alembic autogenerate).
// Sequelize registers each model against the shared `sequelize` instance as
// soon as its defining file is required, so requiring this index file (which
// requires every model file) serves the equivalent "make sure everything is
// registered" role.

const sequelize = require('../db/sequelize');
const { TournamentState, TournamentSize, TournamentStake } = require('./enums');
const User = require('./user');
const Admin = require('./admin');
const {
  Tournament,
  TournamentRegistration,
  TournamentTable,
  tournamentToDict,
} = require('./tournament');
const TournamentTicket = require('./ticket');
const {
  KYCStatus,
  WalletBalance,
  WalletTransaction,
  PaymentMethod,
  DepositRequest,
  WithdrawalRequest,
} = require('./real_money');
const { PaymentStatus, PaymentRecord } = require('./payment_models');
const { KYCState, KYCRecord } = require('./kyc_models');
const ComplianceFlag = require('./compliance_models');
const CollusionFlag = require('./collusion_flag');
const HandHistory = require('./hand_history');
const HandHistoryExporter = require('./hand_history_exporter');
const DemoHandHistory = require('./demo_hand_history');
// NOTE (public version): the Game model backing the proprietary provably-fair
// engine is excluded from this repository — see backend/services/rng/README.md.

module.exports = {
  sequelize,
  User,
  Admin,
  TournamentState,
  TournamentSize,
  TournamentStake,
  Tournament,
  TournamentRegistration,
  TournamentTable,
  tournamentToDict,
  TournamentTicket,
  KYCStatus,
  WalletBalance,
  WalletTransaction,
  PaymentMethod,
  DepositRequest,
  WithdrawalRequest,
  PaymentStatus,
  PaymentRecord,
  KYCState,
  KYCRecord,
  ComplianceFlag,
  CollusionFlag,
  HandHistory,
  HandHistoryExporter,
  DemoHandHistory,
};
