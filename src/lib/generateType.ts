import {
    quicktype,
    InputData,
    jsonInputForTargetLanguage,
    JSONSchemaInput,
    FetchingJSONSchemaStore,
} from "quicktype-core";

export async function generateTypesFromJson(
    json: unknown,
    rootTypeName = "Root"
) {
    const jsonInput = jsonInputForTargetLanguage("typescript");

    // Convert object to JSON string
    await jsonInput.addSource({
        name: rootTypeName,
        samples: [JSON.stringify(json)],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: {
            "just-types": "true",
        },
    });

    return result.lines.join("\n");
}

export async function generateTypesFromSchema(
    schema: string,
    rootTypeName = "Root"
) {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());

    await schemaInput.addSource({
        name: rootTypeName,
        schema: schema,
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: {
            "just-types": "true",
        },
    });

    return result.lines.join("\n");
}

export async function generateTypesFromMultipleSchemas(
    sources: { name: string; schema: string }[]
) {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());

    for (const source of sources) {
        await schemaInput.addSource({
            name: source.name,
            schema: source.schema,
        });
    }

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: {
            "just-types": "true",
        },
    });

    return result.lines.join("\n");
}
