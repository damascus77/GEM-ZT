FROM node:20-alpine
# Prisma on Alpine (musl) needs OpenSSL present so it can detect libssl and load
# the correct query engine; without it Prisma warns and defaults to openssl-1.1.x.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
# Default SQLite location so the image runs standalone (`docker run`) as well as
# via docker-compose (which sets the same value). The directory must exist because
# `prisma migrate deploy` writes the SQLite file here at startup; a mounted volume
# (compose app_data:/data) transparently takes over this path at runtime.
ENV DATABASE_URL=file:/data/gemzt.db
RUN mkdir -p /data
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
