"""Server-side enforcement of real brand assets on slides.

The model does not reliably honour "use the real logo" instructions: it writes an
image prompt anyway, and utils/process_slides then generates a stock picture over
the top. So after validation we pin the real URL and drop the prompt, which makes
the asset processor skip that slot.

The interesting cases are the negative ones — a decorative image must never be
hijacked into someone's headshot.
"""

from services.chat.branding_assets import (
    apply_brand_assets_to_content,
    build_profiles,
    sanitize_brand,
)

BRANDING = {
    "fullName": "Jane Doe",
    "company": "Acme Lending",
    "logoUrl": "https://cdn.example/acme-logo.png",
    "headshotUrl": "https://cdn.example/jane.jpg",
    "nmls": "12345",
    "email": "jane@acme.example",
}
PARTNER = {
    "name": "Melissa Smith",
    "type": "realtor",
    "logoUrl": "https://cdn.example/melissa-logo.png",
    "headshotUrl": "https://cdn.example/melissa.jpg",
}


def _v1_slot(prompt: str, url: str = "") -> dict:
    return {"__image_prompt__": prompt, "__image_url__": url}


def _v2_image(name: str, prompt: str, data: str = "", is_icon: bool = False) -> dict:
    return {
        "type": "image",
        "is_icon": is_icon,
        "name": name,
        "prompt": prompt,
        "data": data,
    }


class TestSanitize:
    def test_maps_field_name_variants(self):
        profile = sanitize_brand(BRANDING)
        assert profile["name"] == "Jane Doe"
        assert profile["company_name"] == "Acme Lending"
        assert profile["logo_url"] == "https://cdn.example/acme-logo.png"

    def test_drops_oversized_values(self):
        """Guards against a base64 data URI being inlined into the prompt."""
        profile = sanitize_brand({"logoUrl": "data:image/png;base64," + "A" * 5000})
        assert profile is None or "logo_url" not in profile

    def test_ignores_non_dict(self):
        assert sanitize_brand("nope") is None
        assert sanitize_brand(None) is None

    def test_build_profiles_puts_user_first(self):
        profiles = build_profiles(BRANDING, [PARTNER])
        assert [p["name"] for p in profiles] == ["Jane Doe", "Melissa Smith"]


class TestV1Slots:
    def test_pins_logo_and_drops_prompt(self):
        content = {"slots": [_v1_slot("the Acme Lending logo")]}
        assert apply_brand_assets_to_content(content, BRANDING, None) == 1
        slot = content["slots"][0]
        assert slot["__image_url__"] == "https://cdn.example/acme-logo.png"
        assert "__image_prompt__" not in slot

    def test_pins_headshot_when_named(self):
        content = {"slots": [_v1_slot("headshot of Jane Doe")]}
        assert apply_brand_assets_to_content(content, BRANDING, None) == 1
        assert content["slots"][0]["__image_url__"] == "https://cdn.example/jane.jpg"

    def test_leaves_decorative_images_alone(self):
        """The whole point of requiring a name match: a generic portrait must
        keep generating normally instead of becoming the user's face."""
        content = {"slots": [_v1_slot("portrait of a happy family outside a home")]}
        assert apply_brand_assets_to_content(content, BRANDING, None) == 0
        assert content["slots"][0]["__image_prompt__"]

    def test_logo_without_a_matching_name_is_not_hijacked(self):
        content = {"slots": [_v1_slot("a generic bank logo")]}
        assert apply_brand_assets_to_content(content, BRANDING, None) == 0

    def test_partner_logo_is_used_for_cobranding(self):
        content = {"slots": [_v1_slot("Melissa Smith's logo")]}
        assert apply_brand_assets_to_content(content, BRANDING, [PARTNER]) == 1
        assert (
            content["slots"][0]["__image_url__"]
            == "https://cdn.example/melissa-logo.png"
        )

    def test_already_real_url_just_drops_the_prompt(self):
        content = {
            "slots": [
                _v1_slot("anything at all", "https://cdn.example/acme-logo.png")
            ]
        }
        assert apply_brand_assets_to_content(content, BRANDING, None) == 1
        assert "__image_prompt__" not in content["slots"][0]

    def test_uploaded_image_url_is_preserved(self):
        uploaded = [{"url": "https://cdn.example/upload.png"}]
        content = {"slots": [_v1_slot("a chart", "https://cdn.example/upload.png")]}
        assert apply_brand_assets_to_content(content, None, None, uploaded) == 1
        assert "__image_prompt__" not in content["slots"][0]


class TestV2Elements:
    def test_pins_logo_on_a_konva_image_element(self):
        content = {"elements": [_v2_image("Company logo", "the Acme Lending logo")]}
        assert apply_brand_assets_to_content(content, BRANDING, None) == 1
        element = content["elements"][0]
        assert element["data"] == "https://cdn.example/acme-logo.png"
        assert "prompt" not in element

    def test_element_name_alone_is_enough(self):
        """v2 elements carry a name, so a slot can be identified even when the
        model wrote no prompt."""
        content = {"elements": [_v2_image("Jane Doe headshot", "")]}
        assert apply_brand_assets_to_content(content, BRANDING, None) == 1
        assert content["elements"][0]["data"] == "https://cdn.example/jane.jpg"

    def test_icons_are_never_replaced(self):
        content = {
            "elements": [_v2_image("logo icon", "Acme Lending logo", is_icon=True)]
        }
        assert apply_brand_assets_to_content(content, BRANDING, None) == 0
        assert content["elements"][0]["prompt"]

    def test_decorative_element_untouched(self):
        content = {"elements": [_v2_image("Hero photo", "family outside a house")]}
        assert apply_brand_assets_to_content(content, BRANDING, None) == 0
        assert content["elements"][0]["prompt"]

    def test_mixed_v1_and_v2_in_one_tree(self):
        content = {
            "old": [_v1_slot("the Acme Lending logo")],
            "new": {"elements": [_v2_image("Logo", "Acme Lending logo")]},
        }
        assert apply_brand_assets_to_content(content, BRANDING, None) == 2


def test_no_branding_is_a_no_op():
    content = {"slots": [_v1_slot("the Acme Lending logo")]}
    assert apply_brand_assets_to_content(content, None, None) == 0
    assert content["slots"][0]["__image_prompt__"]
