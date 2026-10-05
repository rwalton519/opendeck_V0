const { Sequelize } = require('sequelize');
require('dotenv').config();

// NOTE: The Python project's actual engine/session setup lives in
// `app/database.py`, which was not included in this chunk (routers import
// `from app.database import get_db`, but that file wasn't supplied). This
// reconstructs the minimal Sequelize connection needed for the ORM models in
// this chunk (models/base.py's `Base = declarative_base()`) to actually work
// and for routers to query against, using the same Postgres database
// referenced by the rest of the project (see the sibling chunk's
// alembic.ini: postgresql://postgres:postgres@localhost:5432/transparent_poker).

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/transparent_poker',
  {
    dialect: 'postgres',
    logging: false,
  }
);

module.exports = sequelize;
