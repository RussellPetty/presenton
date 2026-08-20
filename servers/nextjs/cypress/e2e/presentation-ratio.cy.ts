describe("presentation ratio", () => {
  const presentationId = Cypress.env("presentationId");
  const fastApiBaseUrl = Cypress.env("fastApiBaseUrl");
  const expectRenderedRatio = (expected: number) => {
    cy.get('[data-testid="slide-content"]')
      .parent()
      .then(($stage) => {
        const bounds = $stage[0].getBoundingClientRect();
        expect(bounds.width / bounds.height).to.be.closeTo(expected, 0.01);
      });
  };

  before(() => {
    expect(presentationId, "presentationId").to.be.a("string").and.not.be.empty;
    expect(fastApiBaseUrl, "fastApiBaseUrl").to.be.a("string").and.not.be.empty;
  });

  it("toggles all ratios, persists the choice, and restores it after reload", () => {
    cy.intercept("PATCH", "**/api/v1/ppt/presentation/update", (request) => {
      if (request.body?.aspect_ratio === "4:3") {
        request.alias = "saveFourThree";
      }
      if (request.body?.aspect_ratio === "1:1") {
        request.alias = "saveSquare";
      }
    });

    cy.request({
      method: "PATCH",
      url: `${fastApiBaseUrl}/api/v1/ppt/presentation/update`,
      body: { id: presentationId, aspect_ratio: "16:9" },
    });

    cy.visit(
      `/presentation?id=${presentationId}&fastapiUrl=${encodeURIComponent(
        fastApiBaseUrl
      )}`
    );
    cy.get('button[aria-label^="Slide ratio "]', { timeout: 30000 })
      .should("contain.text", "Ratio 16:9")
      .click();
    expectRenderedRatio(16 / 9);

    cy.contains('button[role="menuitemradio"]', "4:3").click();
    cy.get('button[aria-label="Slide ratio 4:3"]')
      .should("be.visible")
      .and("contain.text", "Ratio 4:3");
    expectRenderedRatio(4 / 3);
    cy.wait("@saveFourThree", { timeout: 15000 });

    cy.reload();
    cy.get('button[aria-label="Slide ratio 4:3"]', { timeout: 30000 })
      .should("be.visible")
      .click();
    cy.contains('button[role="menuitemradio"]', "1:1 (4:4)").click();
    cy.get('button[aria-label="Slide ratio 1:1"]')
      .should("be.visible")
      .and("contain.text", "Ratio 1:1");
    expectRenderedRatio(1);
    cy.wait("@saveSquare", { timeout: 15000 });

    cy.request(`${fastApiBaseUrl}/api/v1/ppt/presentation/${presentationId}`)
      .its("body.aspect_ratio")
      .should("equal", "1:1");
  });
});
