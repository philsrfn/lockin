FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm install tsx typescript

COPY . .

EXPOSE 3000

# Migrations are idempotent (tracked in schema_migrations), so running them on
# every boot is safe and means a deploy never needs a second command.
CMD ["sh", "-c", "npm run migrate && npm run start"]
