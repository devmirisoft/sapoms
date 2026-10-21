FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts calls env("DATABASE_URL"), which throws if it's unset. Generate never connects, so a dummy works.
# Several modules read env vars at import time, and next build imports every route.
# Secret mounts expose the .env files to this step only. Next copies .env into
# standalone/, so delete it there or it ends up in the image.
RUN --mount=type=secret,id=env,target=/app/.env \
    --mount=type=secret,id=envlocal,target=/app/.env.local \
    npm run build && rm -f .next/standalone/.env*


FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
