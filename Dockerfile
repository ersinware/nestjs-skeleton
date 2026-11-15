FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS base
WORKDIR /app
RUN apk update && apk upgrade && \
    apk add --no-cache libc6-compat tini
COPY --chown=node:node package*.json ./
RUN mkdir -p /home/node/.npm && chown -R node:node /home/node/.npm /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]

FROM base AS development
ENV CI=false
RUN --mount=type=cache,target=/home/node/.npm,uid=1000 npm install
COPY --chown=node:node . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

FROM base AS builder
ENV CI=true
RUN --mount=type=cache,target=/home/node/.npm,uid=1000 npm ci
COPY --chown=node:node . .
RUN npm run build

FROM base AS prod-deps
ENV CI=true
RUN --mount=type=cache,target=/home/node/.npm,uid=1000 npm ci --omit=dev --ignore-scripts

FROM base AS production
ENV NODE_ENV="production"
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
EXPOSE 3000
# Readiness, not liveness: "healthy" must mean able to serve traffic, and only the readiness probe
# verifies the database and cache. 
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --tries=1 --spider http://localhost:3000/api/health/ready || exit 1
CMD ["node", "dist/src/main.js"]
