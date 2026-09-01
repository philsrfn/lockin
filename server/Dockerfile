FROM node:20-alpine

# Postgres client libs are not needed (pg is pure JS), but tini gives us proper
# signal handling so a deploy shuts the server down cleanly instead of killing
# it mid-request.
RUN apk add --no-cache tini

WORKDIR /app

COPY package.json package-lock.json* ./
# tsx runs TypeScript directly in production too. For a single-user app that is
# the boring choice: no build step to get wrong, and the deployed code is the
# code in the repo.
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm install --no-save tsx \
    && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Migrations are tracked in schema_migrations, so running them on every boot is
# a no-op after the first and a deploy never needs a second command.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npm run migrate && npm run start"]
