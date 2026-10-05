require('dotenv').config();

// Converted from core/config.py:
//
//   class Settings(BaseSettings):
//       SECRET_KEY: str = "dev-secret-key"
//       JWT_ALGORITHM: str = "HS256"
//       model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
//   settings = Settings()
//
// pydantic_settings.BaseSettings auto-loads matching-named environment
// variables (and falls back to the field defaults if unset) - replicated
// here with `process.env.X || <default>`, and dotenv performs the `.env`
// loading pydantic_settings did via env_file=".env".

const settings = {
  SECRET_KEY: process.env.SECRET_KEY || 'dev-secret-key',
  JWT_ALGORITHM: process.env.JWT_ALGORITHM || 'HS256',
};

module.exports = settings;
