"use strict";
const http = require("http");
const https = require("https");
// const { HttpProxyAgent } = require("http-proxy-agent");
// const { HttpsProxyAgent } = require("https-proxy-agent");

module.exports = function agentFactory(proxy, rejectUnauthorized) {
  const agentOpts = { keepAlive: true, rejectUnauthorized };

  // TODO SAIID: Integrate proxies with browser-level libraries
  // if (proxy) {
  //   return { https: new HttpsProxyAgent(proxy, agentOpts), http: new HttpProxyAgent(proxy, agentOpts) };
  // }
  if (proxy) throw new Error("SAIID DEV: Proxies are not supported in the browser");

  return { http: new http.Agent(agentOpts), https: new https.Agent(agentOpts) };
};
