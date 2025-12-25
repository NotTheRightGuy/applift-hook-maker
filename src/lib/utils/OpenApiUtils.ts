
export const enrichSchemaTitles = (schema: any, baseName: string, visited = new Set<any>()) => {
    if (!schema || typeof schema !== 'object') {return;}
    if (visited.has(schema)) {return;}
    visited.add(schema);

    // Force overwrite title to ensure semantic naming based on context (Feature/Endpoint)
    // This prevents generic names like "Data", "Response" or collisions "Data1"
    schema.title = baseName;
    
    if (schema.properties) {
        for (const key of Object.keys(schema.properties)) {
            const pascalKey = key.charAt(0).toUpperCase() + key.slice(1);
            const prop = schema.properties[key];
            
            // Recurse for objects (properties/additionalProperties)
            // Relaxed check: if it has properties, it's an object. 
            if (prop.properties || prop.additionalProperties) {
                enrichSchemaTitles(prop, `${baseName}${pascalKey}`, visited);
            } 
            // Recurse for arrays
            else if (prop.items) {
                enrichSchemaTitles(prop.items, `${baseName}${pascalKey}Item`, visited);
            }
        }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
            enrichSchemaTitles(schema.additionalProperties, `${baseName}Value`, visited);
    }
};

export async function parseOpenApiSpec(input: string): Promise<any> {
    const trimmedInput = input.trim();
    const SwaggerParser = (await import("@apidevtools/swagger-parser")).default;

    try {
        // Normalize input for SwaggerParser
        if (trimmedInput.startsWith("{")) {
            // If it looks like JSON object, parse it first
            const jsonInput = JSON.parse(trimmedInput);
            return await SwaggerParser.bundle(jsonInput);
        } else {
            // Assume URL or file path
            return await SwaggerParser.bundle(trimmedInput);
        }
    } catch (e) {
         throw new Error(`Failed to parse/bundle spec: ${(e as any).message}`);
    }
}

export function getOperationsFromSpec(spec: any) {
    const items: {
        path: string;
        method: string;
        operation: any;
        label: string;
        description: string;
        detail: string;
    }[] = [];

    for (const [path, methods] of Object.entries(spec.paths || {})) {
        for (const [method, operation] of Object.entries(methods as any)) {
            const op = operation as any;
            items.push({
                label: `${method.toUpperCase()} ${path}`,
                description: op.summary || op.operationId || "",
                detail: path,
                path,
                method,
                operation: op,
            });
        }
    }
    return items;
}

export function processSelectedOperations(selectedItems: any[], fullSpec: any) {
    const batchModelsInput: { featureName: string; responseSchema?: string; paramsSchema?: string; wrapperArgs?: string }[] = [];
    const processedItems: any[] = []; 

    for (const selected of selectedItems) {
        const { path, method, operation } = selected;
        
        // Determine Feature Name
        let featureName = operation.operationId;
        if (!featureName) {
            // fallback to path parts
            const parts = path.split('/').filter((p: string) => p && !p.startsWith('{'));
            featureName = parts.length > 0 ? parts[parts.length - 1] : 'feature';
            featureName = method + featureName.charAt(0).toUpperCase() + featureName.slice(1);
        }

        // Sanitize featureName
        featureName = featureName.replace(/[^a-zA-Z0-9]/g, "");
        if (/^\d/.test(featureName)) {
            featureName = `Api${featureName}`;
        }
        if (!featureName) {
            featureName = "ApiFeature";
        }
        
        // Determine Response Schema
        let responseSchemaStr: string | undefined;
        let wrapperArgs: string | undefined;

        const successCode = Object.keys(operation.responses || {}).find(code => code.startsWith('2'));
        const successResponse = successCode ? operation.responses[successCode] : undefined;
        
        if (successResponse && successResponse.content) {
            try {
                // Find appropriate content type
                const content = successResponse.content;
                const contentType = Object.keys(content || {}).find(k => k.includes('json')) || Object.keys(content || {})[0];
                
                if (contentType && content[contentType]?.schema) {
                    const schema = content[contentType].schema;
                 
                    // Check for Wrapper Pattern (success + data)
                    if (schema.type === 'object' && schema.properties && schema.properties.success && schema.properties.data) {
                            // Unwrap!
                            if (schema.properties.totalRecords || schema.properties.filteredRecords) {
                                wrapperArgs = "WithRecordResponse";
                            } else {
                                wrapperArgs = "WithResponse";
                            }
                            
                            const innerSchema = schema.properties.data;
                            enrichSchemaTitles(innerSchema, `${featureName}Data`);
                            
                            const schemaToProcess = {
                                ...innerSchema,
                                components: fullSpec.components,
                                definitions: fullSpec.definitions
                            };
                            responseSchemaStr = JSON.stringify(schemaToProcess);

                    } else {
                            enrichSchemaTitles(schema, `${featureName}Response`);
                            const schemaToProcess = {
                                ...schema,
                                components: fullSpec.components,
                                definitions: fullSpec.definitions
                            };
                            responseSchemaStr = JSON.stringify(schemaToProcess);
                    }
                }
            } catch (e) {
                console.warn("Failed to stringify response schema (circular ref?)", e);
            }
        }
        
        // Determine Params Schema
        let paramsSchemaStr: string | undefined;
        const paramsProperties: Record<string, any> = {};
        const requiredParams: string[] = [];

        // Parameters (query, path)
        if (operation.parameters) {
            for (const param of operation.parameters) {
                    if (param.in === "query" || param.in === "path") {
                        paramsProperties[param.name] = param.schema || {}; 
                        if (param.required) {
                            requiredParams.push(param.name);
                        }
                    }
            }
        }

        // Request Body
        if (operation.requestBody) {
                const bodyContent = operation.requestBody.content?.["application/json"];
                if (bodyContent && bodyContent.schema) {
                    const bodySchema = bodyContent.schema;
                    
                    if (bodySchema.type === "object" && bodySchema.properties) {
                        Object.assign(paramsProperties, bodySchema.properties);
                        if (bodySchema.required) {
                            requiredParams.push(...bodySchema.required);
                        }
                    } else {
                        paramsProperties['body'] = bodySchema;
                        requiredParams.push('body');
                    }
                }
        }

        if (Object.keys(paramsProperties).length > 0) {
                const fullParamSchema: any = {
                    $schema: "http://json-schema.org/draft-07/schema#",
                    type: "object",
                    properties: paramsProperties,
                    required: requiredParams
                };
                
                enrichSchemaTitles(fullParamSchema, `${featureName}Variables`);

                try {
                    const paramsSchemaWithDefs = {
                        ...fullParamSchema,
                        components: fullSpec.components,
                        definitions: fullSpec.definitions
                    };
                    paramsSchemaStr = JSON.stringify(paramsSchemaWithDefs);
                } catch (e) {
                    console.warn("Failed to stringify params schema", e);
                }
        }

        if (featureName) {
            batchModelsInput.push({
                featureName,
                responseSchema: responseSchemaStr,
                paramsSchema: paramsSchemaStr,
                wrapperArgs
            });
        }

        processedItems.push({
                featureName,
                method,
                path,
                responseSchemaStr,
                paramsSchemaStr,
                wrapperArgs
        });
    }

    return { batchModelsInput, processedItems };
}
