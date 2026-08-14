import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { coston2 } from "./chains";

export const wagmiConfig = createConfig({
  chains: [coston2],
  connectors: [injected()],
  transports: {
    [coston2.id]: http(),
  },
  // Coston2's public RPC rate-limits under load; the default 4s block-watcher
  // poll (eth_getBlockByNumber) is the main source of that load. Post-tx
  // state is refetched explicitly and immediately, so slowing background
  // polling doesn't reintroduce the stale-panel bug — it only makes the app
  // quieter between actions.
  pollingInterval: 15_000,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
