const express = require("express");
const { apiSessionMiddleware } = require("./auth");
const { addCoreRoutes } = require("./api-core");
const { addActionRoutes } = require("./api-actions");
const { addPageRoutes } = require("./api-pages");

const router = express.Router();

addPageRoutes(router);
router.use(apiSessionMiddleware);
addCoreRoutes(router);
addActionRoutes(router);

module.exports = router;
