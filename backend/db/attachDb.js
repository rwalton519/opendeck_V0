const sequelize = require('./sequelize');

// NOTE: app.database.get_db (the actual FastAPI DB-session dependency) was
// not included in this chunk. This is minimal infra wiring so `req.db`
// exists for routers that received `db: Session = Depends(get_db)`,
// mirroring the equivalent middleware in the sibling chunk's project.
function attachDb(req, res, next) {
  req.db = sequelize;
  next();
}

module.exports = attachDb;
