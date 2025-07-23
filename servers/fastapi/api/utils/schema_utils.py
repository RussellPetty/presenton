"""
Utility functions for converting OpenAI/Pydantic schemas to Google Vertex AI compatible format.
"""
import json
from typing import Any, Dict


def convert_schema_types_for_vertex_ai(schema: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert Pydantic-generated JSON schema to Google Vertex AI compatible format.
    
    Google Vertex AI expects schema types in uppercase format:
    - "object" -> "OBJECT"
    - "array" -> "ARRAY"  
    - "string" -> "STRING"
    - "number" -> "NUMBER"
    - "integer" -> "INTEGER"
    - "boolean" -> "BOOLEAN"
    """
    if isinstance(schema, dict):
        converted = {}
        for key, value in schema.items():
            if key == "type" and isinstance(value, str):
                # Convert lowercase type to uppercase for Vertex AI
                converted[key] = value.upper()
            elif key == "anyOf" and isinstance(value, list):
                # Handle optional fields with anyOf structure
                converted[key] = [convert_schema_types_for_vertex_ai(item) for item in value]
            elif isinstance(value, dict):
                converted[key] = convert_schema_types_for_vertex_ai(value)
            elif isinstance(value, list):
                converted[key] = [convert_schema_types_for_vertex_ai(item) if isinstance(item, dict) else item for item in value]
            else:
                converted[key] = value
        return converted
    elif isinstance(schema, list):
        return [convert_schema_types_for_vertex_ai(item) if isinstance(item, dict) else item for item in schema]
    else:
        return schema


def get_vertex_ai_compatible_schema(pydantic_model) -> Dict[str, Any]:
    """
    Generate a Google Vertex AI compatible schema from a Pydantic model.
    """
    original_schema = pydantic_model.model_json_schema()
    return convert_schema_types_for_vertex_ai(original_schema)


def debug_schema_compatibility(schema: Dict[str, Any], model_name: str = "Unknown") -> None:
    """
    Debug utility to check schema compatibility and log potential issues.
    """
    print(f"\n=== Schema Debug for {model_name} ===")
    print(f"Root type: {schema.get('type', 'MISSING')}")
    
    # Check for common issues
    issues = []
    
    if "type" not in schema:
        issues.append("Missing root 'type' field")
    elif schema["type"] not in ["OBJECT", "ARRAY", "STRING", "NUMBER", "INTEGER", "BOOLEAN"]:
        issues.append(f"Invalid root type: {schema['type']} (should be uppercase)")
    
    # Check properties for missing types
    if "properties" in schema:
        for prop_name, prop_schema in schema["properties"].items():
            if isinstance(prop_schema, dict):
                if "type" not in prop_schema and "anyOf" not in prop_schema and "$ref" not in prop_schema:
                    issues.append(f"Property '{prop_name}' missing type field")
    
    if issues:
        print("ISSUES FOUND:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("Schema appears compatible with Vertex AI")
    
    print(f"Schema keys: {list(schema.keys())}")
    print("=" * 50)