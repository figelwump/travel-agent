import { describe, expect, test } from "bun:test";
import { act } from "react";
import { fireEvent, render } from "@testing-library/react";
import { TasksPane } from "./TasksPane";

const baseTask = {
  id: "task-1",
  name: "Call hotel",
  type: "email-reminder",
  schedule: { runAt: "2026-02-01T09:00:00", timezone: "UTC" },
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  status: "open",
  completedAt: null,
  payload: { tripId: "trip-1", subject: "Call hotel" },
};

function mockFetch(tasks: any[], patchResult?: any) {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method || "GET").toUpperCase();

    if (url.startsWith("/api/scheduler/tasks") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(tasks), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    if (url.includes("/api/scheduler/tasks/") && method === "PATCH") {
      return Promise.resolve(
        new Response(JSON.stringify(patchResult || tasks[0]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    return Promise.resolve(new Response("Not Found", { status: 404 }));
  };
}

async function renderPane() {
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    utils = render(
      <TasksPane
        credentials={{ password: "test" }}
        trips={[{ id: "trip-1", name: "Trip One" }]}
        activeTripId="trip-1"
        itineraryMarkdown=""
        onRefreshItinerary={() => {}}
        refreshToken={0}
      />
    );
  });
  return utils!;
}

describe("TasksPane", () => {
  test("keeps a task visible in Open after marking done", async () => {
    const doneResult = {
      ...baseTask,
      status: "done",
      completedAt: "2026-01-02T10:00:00Z",
    };
    mockFetch([baseTask], doneResult);
    const { findByText, getByTitle, getByText, getByRole } = await renderPane();

    await findByText("Call hotel");
    const markDone = getByTitle("Mark as done");
    await act(async () => {
      fireEvent.click(markDone);
    });

    const title = getByText("Call hotel");
    expect(title).toBeInTheDocument();
    expect(title.closest(".task-card")).toHaveClass("done");
    expect(getByRole("button", { name: /Open \(1\)/ })).toBeInTheDocument();
  });

  test("shows Reminder sent badge when lastRun is present", async () => {
    const sentTask = {
      ...baseTask,
      lastRun: "2026-01-03T09:00:00Z",
    };
    mockFetch([sentTask]);
    const { findByText, getByText } = await renderPane();

    await findByText("Call hotel");
    expect(getByText("Reminder sent")).toBeInTheDocument();
  });

  test("renders the check button before task content", async () => {
    mockFetch([baseTask]);
    const { findByText } = await renderPane();

    const title = await findByText("Call hotel");
    const card = title.closest(".task-card");
    expect(card?.firstElementChild).toHaveClass("task-check");
  });
});
