FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node demo ./demo
USER node
ENV HOST=0.0.0.0 PORT=3030
EXPOSE 3030
CMD ["node", "src/server.js"]
