// Converted from models/base.py:
//
//   from sqlalchemy.orm import declarative_base
//   Base = declarative_base()
//
// Sequelize doesn't use a declarative base class the way SQLAlchemy does -
// each model registers itself against the shared `sequelize` connection
// instance directly (see db/sequelize.js). This file is kept only for
// folder-structure parity with the original project and simply re-exports
// that shared connection, which is the closest equivalent to "the shared
// Base metadata every model attaches to".

module.exports = require('../db/sequelize');
