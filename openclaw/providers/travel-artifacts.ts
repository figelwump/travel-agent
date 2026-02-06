import type { Artifact, ArtifactProvider } from "../artifacts";
import type { createStorage } from "../storage";

type Storage = ReturnType<typeof createStorage>;

export function createTravelArtifactProvider(storage: Storage): ArtifactProvider {
  return {
    id: "travel",

    async list(opts) {
      if (opts?.source && opts.source !== "travel") return [];
      if (opts?.kind && opts.kind !== "itinerary") return [];

      const trips = await storage.listTrips();
      return trips.map((trip): Artifact => ({
        id: `travel:itinerary:${trip.id}`,
        source: "travel",
        kind: "itinerary",
        title: `${trip.name} — Itinerary`,
        mimeType: "text/markdown",
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
        sourceRef: trip.id,
        tags: ["travel", "itinerary"],
      }));
    },

    async get(id) {
      const tripId = parseTripId(id);
      if (!tripId) return null;
      const trip = await storage.getTrip(tripId);
      if (!trip) return null;
      return {
        id,
        source: "travel",
        kind: "itinerary",
        title: `${trip.name} — Itinerary`,
        mimeType: "text/markdown",
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
        sourceRef: trip.id,
        tags: ["travel", "itinerary"],
      };
    },

    async getContent(id) {
      const tripId = parseTripId(id);
      if (!tripId) return null;
      const content = await storage.readItinerary(tripId);
      if (!content) return null;
      return { data: content, mimeType: "text/markdown" };
    },
  };
}

function parseTripId(artifactId: string): string | null {
  const prefix = "travel:itinerary:";
  if (!artifactId.startsWith(prefix)) return null;
  const tripId = artifactId.slice(prefix.length);
  return tripId || null;
}
