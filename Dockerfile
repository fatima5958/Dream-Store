# syntax=docker/dockerfile:1
# Reproducible production image for DreamStore's Node/Express + Vite application.
FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run lint && bun run build

FROM node:24-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DREAMSTORE_PAID_CHECKOUT_ENABLED=false
# Never put production service credentials or signing secrets in the image.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/server ./server
COPY --from=build /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=build /app/firestore.rules ./firestore.rules
COPY --from=build /app/storage.rules ./storage.rules
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node
EXPOSE 8080
CMD ["npm", "start"]
