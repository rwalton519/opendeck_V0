/* eslint-disable camelcase */

exports.shorthands = undefined;

// Two unrelated additions, bundled into one migration since both exist only
// to support the new Admin Dashboard (public/admin/index.html +
// admin/adminDashboardRouter.js):
//
// 1. IP tracking on `users`. Nothing in this codebase captured a client IP
//    anywhere before this - services/payments/achService.js even has a
//    literal `ip_address: '127.0.0.1', // replace with real client IP`
//    placeholder. The dashboard's accounts table asks for an IP per
//    account, so this adds real columns for it (see models/user.js,
//    auth/serviceAuth.js, auth/routerAuth.js for where they're populated).
//    `last_login_ip`/`last_login_at` are separate from `signup_ip` since
//    they answer different questions (where an account was created vs.
//    where it's currently being used from) and only one of them existed
//    even as a concept before now.
//
// 2. Seeds the Admin row the dashboard's login page authenticates against
//    via the EXISTING POST /admin/login (admin/adminAuth.js) - this does
//    not add a second, parallel auth system. The password hash below is a
//    real bcrypt hash (10 rounds, matching models/admin.js's SALT_ROUNDS)
//    of the password given for this account; change it via
//    POST /admin/login -> (a "change admin password" endpoint does not
//    exist yet - flagging that as a gap, not silently working around it by
//    inventing one here) or by generating a new hash the same way
//    (`bcrypt.hashSync(newPassword, 10)`) and updating the row directly.
exports.up = async (pgm) => {
  pgm.addColumns('users', {
    signup_ip: { type: 'varchar(64)', notNull: false },
    last_login_ip: { type: 'varchar(64)', notNull: false },
    last_login_at: { type: 'timestamp', notNull: false },
  });

  pgm.sql(`
    INSERT INTO admins (username, password_hash)
    VALUES ('rwalton22', '$2a$10$C.VWBRp.Ew.sRjCzo1x/7uFcqTzSDSQZO3F86adruvXgtt/05IrQy')
    ON CONFLICT (username) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM admins WHERE username = 'rwalton22';`);
  pgm.dropColumns('users', ['signup_ip', 'last_login_ip', 'last_login_at']);
};
