# The backend and its Mosquitto broker in one container.
# Render builds the last stage (production); `make test-docker` builds `test`.

FROM node:24-alpine AS base
# Mosquitto with the Dynamic Security plugin, from Alpine's packages.
RUN apk add --no-cache mosquitto \
 && mosquitto -h | head -1
WORKDIR /app
COPY package.json package-lock.json ./

# All dependencies, then the test suite (broker tests included).
FROM base AS test
RUN npm ci
COPY . .
CMD ["npm", "test"]

FROM base AS production
ENV NODE_ENV=production
RUN npm ci --omit=dev
COPY . .
USER node
CMD ["node", "server.js"]
