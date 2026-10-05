import "dotenv/config";
import pkg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pkg;

const DEMO_USERS = [
  { email: "demo1@sidebet.dev", password: "password123" },
  { email: "demo2@sidebet.dev", password: "password123" },
];

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in first.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const u of DEMO_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await pool.query(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [u.email, hash]
      );
    }
    console.log("Seeded demo users (balance defaults to 1000 each):");
    DEMO_USERS.forEach((u) => console.log(`  ${u.email} / ${u.password}`));
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
