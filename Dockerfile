FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY demo ./demo
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/demo ./demo
USER node
ENV HOST=0.0.0.0 PORT=3030
EXPOSE 3030
CMD ["node", "dist/server.js"]
