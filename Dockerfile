# Slate: the API and the built web app in one image.
# The server serves apps/web/dist when NODE_ENV=production, so the app and API share an origin.
FROM node:26-slim AS build
WORKDIR /app

COPY services/server/package.json services/server/package-lock.json services/server/
RUN npm ci --prefix services/server
COPY services/server services/server
RUN npm run build --prefix services/server

COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN npm ci --prefix apps/web
COPY apps/web apps/web
RUN npm run build --prefix apps/web

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app

COPY services/server/package.json services/server/package-lock.json services/server/
RUN npm ci --omit=dev --prefix services/server && npm cache clean --force
COPY --from=build /app/services/server/dist services/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

USER node
EXPOSE 8787
CMD ["node", "services/server/dist/index.js"]
