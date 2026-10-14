import { useEffect } from "react";
import { graphql, useQueryLoader, type PreloadedQuery } from "react-relay";

const PlotQuery = graphql`
  query PlotQuery($id: ID!, $season: String) {
    plot(id: $id) { name crops(season: $season) { name } }
  }
`;

const SeedsQuery = graphql`
  query SeedsQuery($first: Int!) {
    seeds(first: $first) { edges { node { name } } }
  }
`;

const HarvestQuery = graphql`
  query HarvestQuery($year: Int!) {
    harvest(year: $year) { total }
  }
`;

export function PlotPage({ plotId }: { plotId: string }) {
  const [plotRef, loadPlot] = useQueryLoader(PlotQuery);
  useEffect(() => {
    loadPlot({ id: plotId, season: "spring" });
  }, [plotId, loadPlot]);
  return plotRef;
}

export function SeedShelf() {
  const [seedsRef, loadSeeds] = useQueryLoader(SeedsQuery);
  return { seedsRef, few: () => loadSeeds({ first: 5 }), many: () => loadSeeds({ first: 50 }, { fetchPolicy: "network-only" }) };
}

export function HarvestPanel({ onReady }: { onReady: (load: (v: { year: number }) => void) => void }) {
  const [harvestRef, loadHarvest] = useQueryLoader(HarvestQuery);
  // handed to the parent: the variables are given there
  onReady(loadHarvest);
  return harvestRef as PreloadedQuery<never> | null | undefined;
}
