import assert from "node:assert/strict";
import test from "node:test";

import {
  areMediaUrlsEqual,
  canonicalizeMediaUrlForComparison,
  collectBrandPhotoAssets,
} from "./mediaAssets.js";

const BASE = "https://presenton.example/presentation/123";

test("matches persisted raw spaces to the browser's encoded image src", () => {
  assert.equal(
    areMediaUrlsEqual(
      "https://storage.example/user/images/Tammy Headshot.png?token=abc",
      "https://storage.example/user/images/Tammy%20Headshot.png?token=abc",
      BASE
    ),
    true
  );
});

test("keeps signed queries exact and does not basename-match", () => {
  assert.equal(
    areMediaUrlsEqual(
      "https://storage.example/user/images/photo.png?token=one",
      "https://storage.example/user/images/photo.png?token=two",
      BASE
    ),
    false
  );
  assert.equal(
    areMediaUrlsEqual(
      "https://one.example/images/photo.png?token=one",
      "https://two.example/images/photo.png?token=one",
      BASE
    ),
    false
  );
  assert.equal(
    areMediaUrlsEqual(
      "https://storage.example/user-one/images/photo.png?token=one",
      "https://storage.example/user-two/images/photo.png?token=one",
      BASE
    ),
    false
  );
});

test("matches relative media to its same-origin browser URL", () => {
  assert.equal(
    areMediaUrlsEqual(
      "/app_data/images/Amy and Evan.jpg",
      "https://presenton.example/app_data/images/Amy%20and%20Evan.jpg",
      BASE
    ),
    true
  );
});

test("allows host changes only for backend-served asset namespaces", () => {
  assert.equal(
    areMediaUrlsEqual(
      "http://localhost:5000/app_data/images/team photo.png?v=1",
      "https://presenton.example/app_data/images/team%20photo.png?v=1",
      BASE
    ),
    true
  );
  assert.equal(
    areMediaUrlsEqual(
      "https://storage-one.example/user/images/team.png?v=1",
      "https://storage-two.example/user/images/team.png?v=1",
      BASE
    ),
    false
  );
});

test("does not decode escaped path separators", () => {
  assert.notEqual(
    canonicalizeMediaUrlForComparison("https://storage.example/a%2Fb.png", BASE),
    canonicalizeMediaUrlForComparison("https://storage.example/a/b.png", BASE)
  );
});

test("collects and labels user and partner brand photos", () => {
  assert.deepEqual(
    collectBrandPhotoAssets(
      {
        fullName: "Tammy Metzger",
        headshotUrl: "https://img.example/tammy.jpg",
        logoUrl: "https://img.example/mortgage-dogs.png",
      },
      [
        {
          id: "amy-evan",
          name: "Amy & Evan",
          headshotUrl: "https://img.example/amy evan.jpg",
          logoUrl: null,
        },
        {
          id: "duplicate",
          name: "Duplicate",
          headshotUrl: "https://img.example/amy%20evan.jpg",
        },
      ]
    ).map(({ label, url }) => ({ label, url })),
    [
      { label: "My headshot", url: "https://img.example/tammy.jpg" },
      { label: "My logo", url: "https://img.example/mortgage-dogs.png" },
      { label: "Amy & Evan headshot", url: "https://img.example/amy evan.jpg" },
    ]
  );
});
