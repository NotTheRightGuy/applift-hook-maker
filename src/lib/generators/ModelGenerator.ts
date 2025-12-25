
import { GenerateFilesProps, ModelResult } from "../types";
import { generateTypesFromJson, generateTypesFromSchema } from "../generateType";
import { parseJson } from "../utils/StringUtils";

export async function generateModels(props: GenerateFilesProps, pascalName: string): Promise<ModelResult> {
    const {
        featureName,
        exampleResponse,
        params,
        responseSchema,
        paramsSchema,
        skipModelGeneration,
        apiUrl
    } = props;

    let responseModel = `export type ${pascalName}Response = any;`;
    let apiReturnType = `${pascalName}Response`; 

    // --- Response Model Generation ---
    if (responseSchema) {
        let typeName = `${pascalName}Response`;
        if (props.wrapperArgs) {
             typeName = `${pascalName}Data`;
        }

        if (!skipModelGeneration) {
            try {
                responseModel = await generateTypesFromSchema(responseSchema, typeName);
            } catch (e) {
                throw new Error(`Failed to generate response types from schema: ${(e as Error).message}`);
            }
        } else {
            responseModel = ""; 
        }
        apiReturnType = typeName;
    } else if (exampleResponse && exampleResponse.trim()) {
        try {
            const parsed = await parseJson(exampleResponse);
            if (parsed.success === true && parsed.data) {
                const dataBlock = parsed.data;
                const headerKeys = ["totalRecords", "filteredRecords"];
                const isPaginated = headerKeys.every((k) => k in dataBlock);

                if (isPaginated) {
                    const arrayKey = Object.keys(dataBlock).find((k) => Array.isArray(dataBlock[k]));
                    if (arrayKey && dataBlock[arrayKey].length > 0) {
                        const itemExample = dataBlock[arrayKey][0];
                        const itemTypeName = featureName.charAt(0).toUpperCase() + featureName.slice(1) + "Item";

                         if (!skipModelGeneration) {
                            responseModel = await generateTypesFromJson(itemExample, itemTypeName);
                        } else {
                            responseModel = "";
                        }

                        if (arrayKey === 'data') {
                            apiReturnType = `WithRecordResponse<${itemTypeName}[]>`;
                        } else {
                            apiReturnType = `WithCustomRecordResponse<'${arrayKey}', ${itemTypeName}>`;
                        }
                    } else {
                        const typeName = `${pascalName}Data`;
                        if (!skipModelGeneration) {
                            responseModel = await generateTypesFromJson(dataBlock, typeName);
                        } else {
                            responseModel = "";
                        }
                        apiReturnType = `WithResponse<${typeName}>`;
                    }
                } else {
                    const typeName = `${pascalName}Response`;
                     if (!skipModelGeneration) {
                        responseModel = await generateTypesFromJson(dataBlock, typeName);
                    } else {
                        responseModel = "";
                    }
                    apiReturnType = `WithResponse<${typeName}>`;
                }
            } else {
                const typeName = `${pascalName}Response`;
                if (!skipModelGeneration) {
                    responseModel = await generateTypesFromJson(parsed, typeName);
                } else {
                    responseModel = "";
                }
                apiReturnType = typeName;
            }
        } catch (e) {
            throw new Error(`Failed to generate response types: ${(e as Error).message}`);
        }
    }

    // --- Variables Model Generation ---
    const urlVars = Array.from(apiUrl.matchAll(/(\$?)\{(\w+)\}/g)).map((m) => m[2]);
    let paramsJson: Record<string, any> = {};

    if (params && params.trim()) {
        try {
            const parsed = await parseJson(params);
            paramsJson = Array.isArray(parsed) ? (parsed[0] || {}) : parsed;
        } catch (e) {
            throw new Error(`Failed to parse params JSON: ${(e as Error).message}`);
        }
    }

    urlVars.forEach((v) => {
        if (!(v in paramsJson)) {
            paramsJson[v] = 123;
        }
    });

    let variablesInterfaceName = `${pascalName}Variables`;
    let variablesDefinition = "";
    let variablesType = "any";

    if (paramsSchema) {
         if (!skipModelGeneration) {
            variablesDefinition = await generateTypesFromSchema(paramsSchema, variablesInterfaceName);
         }
        variablesType = variablesInterfaceName;
    } else if (Object.keys(paramsJson).length > 0) {
        if (!skipModelGeneration) {
            variablesDefinition = await generateTypesFromJson(paramsJson, variablesInterfaceName);
        }
        variablesType = variablesInterfaceName;
    } else {
        variablesType = "void";
    }

    return {
        responseModel,
        apiReturnType,
        variablesDefinition,
        variablesType,
        paramsJson,
        urlVars,
        variablesInterfaceName
    };
}

export async function generateBatchModels(
    items: { featureName: string; responseSchema?: string; paramsSchema?: string; wrapperArgs?: string }[]
): Promise<string> {
    const { generateTypesFromMultipleSchemas } = await import("../generateType.js");
    const sources: { name: string; schema: string }[] = [];

    for (const item of items) {
        const pascalName = item.featureName.charAt(0).toUpperCase() + item.featureName.slice(1);
        
        if (item.responseSchema) {
            const modelName = item.wrapperArgs ? `${pascalName}Data` : `${pascalName}Response`;
            sources.push({
                name: modelName,
                schema: item.responseSchema
            });
        }
        
        if (item.paramsSchema) {
             sources.push({
                name: `${pascalName}Variables`,
                schema: item.paramsSchema
            });
        }
    }

    if (sources.length === 0) {return "";}
    return generateTypesFromMultipleSchemas(sources);
}
