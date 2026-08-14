import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { coston2 } from "./chains";

export const wagmiConfig = createConfig({
  chains: [coston2],
  connectors: [injected()],
  transports: {
    [coston2.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
