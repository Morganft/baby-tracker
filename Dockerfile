# --- build stage: full image has the toolchain to compile better-sqlite3 ---
FROM node:22 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
	&& npm prune --omit=dev

# --- runtime stage: slim image, adapter-node server ---
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# SQLite lives on the mounted volume; this single file is the whole dataset.
ENV DATABASE_URL=/data/app.db
ENV PORT=3000

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json

VOLUME /data
EXPOSE 3000
CMD ["node", "build"]
