FROM node:24-alpine

WORKDIR /app

RUN npm init -y >/dev/null \
  && npm pkg set type=commonjs >/dev/null \
  && npm i --omit=dev dotenv@16.6.1 express@4.21.2 nanoid@5.1.5 pg@8.16.3 >/dev/null

COPY server.js ./server.js
COPY bot.names.js ./bot.names.js
COPY public ./public
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
