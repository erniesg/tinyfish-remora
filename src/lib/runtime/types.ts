import type { VenueConnection } from "@/lib/demo/types";

export type RuntimeProvider = "tinyfish" | "review" | "ibkr" | "polymarket";

export interface RuntimeProviderStatus {
  provider: RuntimeProvider;
  enabled: boolean;
  missing: string[];
  note: string;
}

export interface RuntimeStatusResponse {
  mode: "demo" | "hybrid" | "live";
  providers: RuntimeProviderStatus[];
  connections: VenueConnection[];
  warnings: string[];
}
