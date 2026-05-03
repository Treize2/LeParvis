import { buildQuery } from "../api";

describe("buildQuery", () => {
  it("emits scalars and arrays in URLSearchParams form", () => {
    const qs = buildQuery({
      q: "Solesmes",
      type: ["abbey", "monastery"],
      day_of_week: 6,
      radius_km: 10,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("q")).toBe("Solesmes");
    expect(params.getAll("type")).toEqual(["abbey", "monastery"]);
    expect(params.get("day_of_week")).toBe("6");
    expect(params.get("radius_km")).toBe("10");
  });

  it("skips null/undefined/empty values", () => {
    const qs = buildQuery({
      q: undefined,
      city: "",
      celebration_type: undefined,
    });
    expect(qs).toBe("");
  });
});
