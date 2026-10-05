# Node 22 - matches the version pinned for the rest of the OpenDeck stack
# (see the frontend's deployment notes: a Node.js version mismatch was a
# real deployment blocker there, so this pins explicitly rather than
# floating on whatever `node:lts` resolves to at build time).
FROM node:22-slim AS base

WORKDIR /app

# Install dependencies first (separate layer) so `npm install` is only
# re-run when package*.json actually changes, not on every source edit.
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
EXPOSE 8000

# Runs migrations, then starts the server. If migrations are already
# up to date, `node-pg-migrate up` is a no-op - safe to run on every
# container start, including in a multi-replica deployment (node-pg-migrate
# takes an advisory lock, so concurrent replicas starting at once won't
# race each other's migration run).
CMD ["sh", "-c", "npm run migrate:up && node server.js"]
