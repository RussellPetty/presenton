from typing import Optional

from api.utils.model_utils import get_large_model, get_llm_client, get_selected_llm_provider
from api.utils.variable_length_models import (
    get_presentation_markdown_model_with_n_slides,
)
from api.utils.schema_utils import get_vertex_ai_compatible_schema, debug_schema_compatibility
from ppt_config_generator.models import PresentationMarkdownModel
from api.models import SelectedLLMProvider


def get_prompt_template(prompt: str, n_slides: int, language: str, content: str, for_google: bool = False):
    json_instruction = """
                Respond with a JSON object that has this exact structure:
                {
                    "title": "presentation title here",
                    "notes": ["note1", "note2"],
                    "slides": [
                        {"title": "slide title", "body": "slide content in markdown"},
                        {"title": "slide title", "body": "slide content in markdown"}
                    ]
                }
                """ if for_google else "Format the output in the specified JSON schema with structured markdown content."

    return [
        {
            "role": "system",
            "content": f"""
                Create a presentation based on the provided prompt, number of slides, output language, and additional informational details.
                {json_instruction}
    
                # Steps

                1. Identify key points from the provided prompt, including the topic, number of slides, output language, and additional content directions.
                2. Create a concise and descriptive title reflecting the main topic, adhering to the specified language.
                3. Generate a clear title for each slide.
                4. Develop comprehensive content using markdown structure:
                    * Use bullet points (- or *) for lists.
                    * Use **bold** for emphasis, *italic* for secondary emphasis, and `code` for technical terms.
                5. Provide important points from prompt as notes.
                
                # Notes
                - Content must be generated for every slide.
                - Images or Icons information provided in **Input** must be included in the **notes**.
                - Notes should cleary define if it is for specific slide or for the presentation.
                - Slide **body** should not contain slide **title**.
                - Slide **title** should not contain "Slide 1", "Slide 2", etc.
                - Slide **title** should not be in markdown format.
                - There must be exact **Number of Slides** as specified.
                """,
        },
        {
            "role": "user",
            "content": f"""
                **Input:**
                - Prompt: {prompt}
                - Output Language: {language}
                - Number of Slides: {n_slides}
                - Additional Information: {content}
            """,
        },
    ]


async def generate_ppt_content(
    prompt: Optional[str],
    n_slides: int,
    language: Optional[str] = None,
    content: Optional[str] = None,
) -> PresentationMarkdownModel:
    client = get_llm_client()
    model = get_large_model()
    response_model = get_presentation_markdown_model_with_n_slides(n_slides)
    
    # Handle Google Vertex AI schema compatibility
    llm_provider = get_selected_llm_provider()
    print(f"Using LLM provider: {llm_provider}")
    
    try:
        if llm_provider == SelectedLLMProvider.GOOGLE:
            # Google Vertex AI needs uppercase schema types and proper formatting
            print("Using Google Vertex AI - converting schema format...")
            vertex_schema = get_vertex_ai_compatible_schema(response_model)
            debug_schema_compatibility(vertex_schema, f"PresentationModel_{n_slides}_slides")
            
            # Use raw JSON completion instead of parse for Google
            response = await client.chat.completions.create(
                model=model,
                temperature=0.0,  # Lower temperature for more deterministic JSON output
                messages=get_prompt_template(prompt, n_slides, language, content, for_google=True),
                response_format={"type": "json_object"},
            )

            # Parse the response manually since we're not using .parse()
            raw_content = response.choices[0].message.content
            if raw_content:
                import json
                parsed_json = json.loads(raw_content)
                # Truncate title if too long
                if 'title' in parsed_json and len(parsed_json['title']) > 50:
                    parsed_json['title'] = parsed_json['title'][:50]
                parsed_response = response_model(**parsed_json)
                print("Google Vertex AI response parsed successfully")
                return parsed_response
            else:
                raise ValueError("Empty response from Google Vertex AI")
                
        else:
            # Use standard Pydantic model for OpenAI and other providers
            response = await client.beta.chat.completions.parse(
                model=model,
                temperature=0.2,
                messages=get_prompt_template(prompt, n_slides, language, content, for_google=False),
                response_format=response_model,
            )
        
        # This block only executes for non-Google providers
        print("OpenAI API call successful")
        
        # Check if parsing was successful
        parsed_response = response.choices[0].message.parsed
        if parsed_response is None:
            print("Error: API call succeeded but parsing failed (parsed response is None)")
            print(f"Raw response content: {response.choices[0].message.content}")
            print(f"Response role: {response.choices[0].message.role}")
            
            # Try to parse manually when .parsed is None
            print("Attempting manual parsing of JSON response...")
            try:
                import json
                raw_content = response.choices[0].message.content
                if raw_content:
                    print(f"Raw content length: {len(raw_content)} characters")
                    print(f"Raw content preview: {raw_content[:200]}...")
                    
                    # Try to parse the JSON content manually
                    parsed_json = json.loads(raw_content)
                    print(f"JSON parsed successfully. Keys: {list(parsed_json.keys())}")

                    # Truncate title if too long
                    if 'title' in parsed_json and len(parsed_json['title']) > 50:
                        parsed_json['title'] = parsed_json['title'][:50]

                    # Convert back to Pydantic model
                    parsed_response = response_model(**parsed_json)
                    print("Manual parsing successful!")
                else:
                    raise ValueError("No content in response")
            except Exception as parse_error:
                print(f"Manual parsing failed: {parse_error}")
                print(f"Raw content type: {type(raw_content) if 'raw_content' in locals() else 'undefined'}")
                if hasattr(parse_error, '__traceback__'):
                    import traceback
                    print("Traceback:")
                    traceback.print_exc()
                raise ValueError(f"Failed to parse response: {parse_error}") from parse_error
        
        return parsed_response
        
    except Exception as e:
        print(f"Error in OpenAI API call: {str(e)}")
        print(f"Error type: {type(e).__name__}")
        
        # Log additional debug info for Google provider
        if llm_provider == SelectedLLMProvider.GOOGLE:
            print("Google Vertex AI error - Schema debug info:")
            try:
                vertex_schema = get_vertex_ai_compatible_schema(response_model)
                debug_schema_compatibility(vertex_schema, f"ERROR_DEBUG_PresentationModel_{n_slides}_slides")
            except Exception as schema_error:
                print(f"Schema generation error: {schema_error}")
        
        # Re-raise the original exception
        raise
