FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY jcds.config ./
COPY src ./src
COPY data ./data
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=3155 \
    ACADEMY_HOST=0.0.0.0

EXPOSE 3155
CMD ["node", "src/server.js"]
