import React, { useState } from "react";
import Chat from "@/app/(presentation-generator)/presentation/components/Chat";
import {
  PresentationChatApi,
  type ChatStreamHandlers,
} from "@/app/(presentation-generator)/services/api/chat";

function Editor() {
  const [branded, setBranded] = useState(false);
  return (
    <>
      <div data-cy="slide">{branded ? "Broker Marketplace" : "Unbranded slide"}</div>
      <Chat
        presentationId="test-deck"
        onPresentationChanged={() => setBranded(true)}
      />
    </>
  );
}

describe("branding edits", () => {
  beforeEach(() => {
    sessionStorage.clear();
    cy.stub(PresentationChatApi, "listConversations").resolves([]);
  });

  for (const withTrace of [true, false]) {
    it(`refreshes the slide after applying branding ${withTrace ? "during streaming" : "at completion"}`, () => {
      cy.stub(PresentationChatApi, "streamMessage").callsFake(
        async (_payload, handlers: ChatStreamHandlers) => {
          if (withTrace) {
            handlers.onTrace?.({
              tool: "applyUserBranding",
              status: "success",
            });
          }
          return {
            response: "Applied your branding.",
            tool_calls: ["getBrandingProfiles", "applyUserBranding"],
          };
        }
      );
      cy.mount(<Editor />);
      cy.get('[data-cy="slide"]').should("have.text", "Unbranded slide");
      cy.get('textarea').type("add my logo to each slide");
      cy.contains("button", "Send").click();
      cy.get('[data-cy="slide"]').should("have.text", "Broker Marketplace");
    });
  }

  it("keeps the slide unchanged after a branding lookup", () => {
    cy.stub(PresentationChatApi, "streamMessage").resolves({
      response: "Your company is Broker Marketplace.",
      tool_calls: ["getBrandingProfiles"],
    });
    cy.mount(<Editor />);
    cy.get('textarea').type("what is my company?");
    cy.contains("button", "Send").click();
    cy.contains("Your company is Broker Marketplace.").should("be.visible");
    cy.get('[data-cy="slide"]').should("have.text", "Unbranded slide");
  });
});
