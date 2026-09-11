module.exports = {
  apps: [
    {
      name: "relayer-signer1",
      script: "./start-signer1.sh",
    },
    {
      name: "relayer-signer2",
      script: "./start-signer2.sh",
    },
    {
      name: "relayer-monitor",
      script: "./relayer/monitor.js",
    },
  ],
};
