import { generateTypesFromJson, generateTypesFromSchema, generateTypesFromMultipleSchemas } from "./generateType";


function getSafeVarName(key: string): string {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) return key;
    let safe = key.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
    safe = safe.replace(/[^a-zA-Z0-9_$]/g, '');
    if (/^\d/.test(safe)) safe = 'var' + safe;
    const reserved = ['interface', 'class', 'let', 'var', 'const', 'import', 'export', 'type', 'switch', 'case', 'break', 'if', 'else', 'return', 'new', 'this', 'void', 'delete', 'catch', 'try', 'throw', 'typeof', 'instanceof', 'in', 'of', 'for', 'while', 'do', 'continue'];
    if (reserved.includes(safe)) safe = '_' + safe;
    return safe || 'variable';
}

interface GenerateFilesProps {
    featureName: string;
    methodType: string;
    apiUrl: string;
    exampleResponse: string;
    params: string;
    hookType: string;
    responseSchema?: string;
    paramsSchema?: string;
    skipModelGeneration?: boolean;
    wrapperArgs?: string;
}

export interface GenerateFileResponse {
    model: string;
    queryKey: string;
    api: string;
    hook: string;
}
export async function generateBatchModels(
    items: { featureName: string; responseSchema?: string; paramsSchema?: string }[]
): Promise<string> {
    const sources: { name: string; schema: string }[] = [];

    for (const item of items) {
        const pascalName = item.featureName.charAt(0).toUpperCase() + item.featureName.slice(1);
        
        if (item.responseSchema) {
            sources.push({
                name: `${pascalName}Response`,
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

    if (sources.length === 0) return "";
    return generateTypesFromMultipleSchemas(sources);
}
export async function generateFiles(
    props: GenerateFilesProps
): Promise<GenerateFileResponse> {
    const {
        featureName,
        methodType,
        apiUrl,
        exampleResponse,
        params,
        hookType,
        responseSchema,
        paramsSchema,
        skipModelGeneration,
        wrapperArgs
    } = props;
//...
// (Skip to apiFunction generation)
//


    const pascalName =
        featureName.charAt(0).toUpperCase() + featureName.slice(1);
    const camelName =
        featureName.charAt(0).toLowerCase() + featureName.slice(1);

    const getUniqueVarMapping = (keys: string[]) => {
         const mapping = keys.map(key => ({ key, safe: getSafeVarName(key) }));
         const seen = new Set<string>();
         for (const m of mapping) {
             let s = m.safe;
             let counter = 2;
             while (seen.has(s)) {
                s = `${m.safe}_${counter}`;
                counter++;
             }
             m.safe = s;
             seen.add(s);
         }
         return mapping;
    };

    const parseJson = async (input: string): Promise<any> => {
        try {
            const JSON5 = (await import("json5")).default;
            return JSON5.parse(input);
        } catch (e) {
            try {
                let repaired = input.replace(
                    /([}\]"])(?!\s*[,}])\s*"/g,
                    '$1, "'
                );
                repaired = repaired.replace(/(\d+)(?!\s*[,}])\s*"/g, '$1, "');

                const JSON5 = (await import("json5")).default;
                return JSON5.parse(repaired);
            } catch (e2) {
                throw new Error(
                    `Invalid JSON: ${
                        (e as Error).message
                    }. Repair attempt failed: ${(e2 as Error).message}`
                );
            }
        }
    };

    let responseModel = `export type ${pascalName}Response = any;`;
    let apiReturnType = `${pascalName}Response`; // Default fallback

    if (responseSchema) {
        const typeName = `${pascalName}Response`;
        if (!skipModelGeneration) {
            try {
                responseModel = await generateTypesFromSchema(
                    responseSchema,
                    typeName
                );
            } catch (e) {
                 throw new Error(
                    `Failed to generate response types from schema: ${(e as Error).message}`
                );
            }
        } else {
            responseModel = ""; // Skipped
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
                    const arrayKey = Object.keys(dataBlock).find((k) =>
                        Array.isArray(dataBlock[k])
                    );

                    if (arrayKey && dataBlock[arrayKey].length > 0) {
                        const itemExample = dataBlock[arrayKey][0];
                        const itemTypeName =
                            featureName.charAt(0).toUpperCase() +
                            featureName.slice(1) +
                            "Item";

                         if (!skipModelGeneration) {
                            const generatedType = await generateTypesFromJson(
                                itemExample,
                                itemTypeName
                            );
                            responseModel = generatedType;
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
                            responseModel = await generateTypesFromJson(
                                dataBlock,
                                typeName
                            );
                        } else {
                            responseModel = "";
                        }
                        apiReturnType = `WithResponse<${typeName}>`;
                    }
                } else {
                    const typeName = `${pascalName}Response`;
                     if (!skipModelGeneration) {
                        responseModel = await generateTypesFromJson(
                            dataBlock,
                            typeName
                        );
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
            throw new Error(
                `Failed to generate response types: ${(e as Error).message}`
            );
        }
    }

    let variablesCode = "";
    let variablesType = "any";

    // Normalize URL to use ${param} format for code generation
    const processedApiUrl = apiUrl.replace(/(\$?)\{(\w+)\}/g, (match, prefix, varName) => `\${${getSafeVarName(varName)}}`);
    const urlVars = Array.from(apiUrl.matchAll(/(\$?)\{(\w+)\}/g)).map((m) => m[2]);

    let paramsJson: Record<string, any> = {};

    if (params && params.trim()) {
        try {
            const parsed = await parseJson(params);
            if (Array.isArray(parsed)) {
                paramsJson = parsed[0] || {};
            } else {
                paramsJson = parsed;
            }
        } catch (e) {
            throw new Error(
                `Failed to parse params JSON: ${(e as Error).message}`
            );
        }
    }

    urlVars.forEach((v) => {
        if (!(v in paramsJson)) {
            paramsJson[v] = 123;
        }
    });

    let variablesInterfaceName = `${pascalName}Variables`;
    let variablesDefinition = "";
    
    if (paramsSchema) {
         if (!skipModelGeneration) {
            variablesDefinition = await generateTypesFromSchema(
                paramsSchema,
                variablesInterfaceName
            );
         }
        variablesType = variablesInterfaceName;
    } else if (Object.keys(paramsJson).length > 0) {
        if (!skipModelGeneration) {
            variablesDefinition = await generateTypesFromJson(
                paramsJson,
                variablesInterfaceName
            );
        }
        variablesType = variablesInterfaceName;
    } else {
        variablesType = "void";
    }

    const apiFunctionName = camelName;
    const queryKeyName = `${camelName}Key`;

    const httpMethod = methodType.toLowerCase();

    let apiArgsRaw = "";
    let apiArgsTyped = "";

    if (variablesType !== "void" && variablesType !== "any") {
        const keys = Object.keys(paramsJson);
        if (keys.length > 0) {
            const mapping = getUniqueVarMapping(keys);
            apiArgsRaw = `{ ${mapping.map(m => m.key === m.safe ? m.key : `${JSON.stringify(m.key)}: ${m.safe}`).join(", ")} }`;
            apiArgsTyped = `: ${variablesType}`;
        }
    } else if (urlVars.length > 0) {
        const mapping = getUniqueVarMapping(urlVars);
        apiArgsRaw = `{ ${mapping.map(m => m.key === m.safe ? m.key : `${JSON.stringify(m.key)}: ${m.safe}`).join(", ")} }`;
        apiArgsTyped = `: { ${urlVars.map((v) => `${JSON.stringify(v)}: any`).join("; ")} }`;
    }

    // If we have paramsSchema, we can't easily filter bodyParams vs urlVars without parsing schema
    // For now, we assume if paramsSchema is present, bodyParams are all keys in the schema minus urlVars?
    // Actually, for generateFiles, bodyParams is a string array of Keys used for destructuring or building the axios call.
    // If we only have schema, we don't know the exact keys easily without parsing the generated TS or the schema JSON.
    // But we CAN parse the schema JSON here since it's passed as string.
    
    let bodyParams: string[] = [];

    if (paramsSchema) {
        try {
            const parsedSchema = JSON.parse(paramsSchema);
            // Assuming simple object schema properties
             if (parsedSchema.properties) {
                bodyParams = Object.keys(parsedSchema.properties).filter(
                    (k) => !urlVars.includes(k)
                );
             }
        } catch (e) {
            // ignore
        }
    } else {
        bodyParams = Object.keys(paramsJson).filter(
            (k) => !urlVars.includes(k)
        );
    }

    let apiFunction = "";

    if (hookType === "useQuery" || hookType === "useInfiniteQuery") {
        let allVars: string[] = [];
        if (paramsSchema) {
             // If schema, we need keys. We tried to parse above.
             // Rethinking: We should parse paramsSchema to get keys if possible.
             try {
                const parsed = JSON.parse(paramsSchema);
                if (parsed.properties) {
                     allVars = [...new Set([...urlVars, ...Object.keys(parsed.properties)])];
                } else {
                     allVars = urlVars;
                }
             } catch(e) { allVars = urlVars; }
        } else {
             allVars = [...new Set([...urlVars, ...Object.keys(paramsJson)])];
        }

        const varMapping = allVars.map(key => ({ key, safe: getSafeVarName(key) }));
        const destructureString = varMapping.length > 0 
            ? varMapping.map(({key, safe}) => key === safe ? key : `${JSON.stringify(key)}: ${safe}`).join(", ")
            : "";

        const destructureLine =
            allVars.length > 0
                ? `  const { ${destructureString} } = queryKey[0];`
                : "";

        let axiosCall = "";
        const method = httpMethod;
        const dataVars = bodyParams;
        
        const dataString = dataVars.length > 0 
             ? `{ ${dataVars.map(k => {
                 const safe = getSafeVarName(k);
                 return k === safe ? k : `${JSON.stringify(k)}: ${safe}`;
             }).join(", ")} }` 
             : "{}";
        
        // Handle pageParam for useInfiniteQuery
        let pageParamLogic = "";
        let pageNoAdjustment = "";
        if (hookType === "useInfiniteQuery") {
             pageParamLogic = `  const { pageParam } = context;`;
             
             // Check if 'pageNo' or similar exists in dataVars
             // If so, we override it with pageParam logic
             const hasPageNo = dataVars.includes("pageNo");
             if (hasPageNo) {
                 // We need to reconstruct the dataString to use pageParam
                 // { ..., pageNo: pageNo ?? pageParam ?? 1, ... }
                 // We can replace "pageNo" with "pageNo: pageNo ?? pageParam ?? 1" in the string if we build it manually
                 // Or we can rebuild the object string
                 const structVars = dataVars.map(v => {
                     const safe = getSafeVarName(v);
                     const keyPart = v === safe ? v : `${JSON.stringify(v)}: ${safe}`;
                     
                     if (v === "pageNo") return `pageNo: ${safe} ?? pageParam ?? 1`;
                     return keyPart;
                 });
                 const newDataString = `{ ${structVars.join(", ")} }`;
                 
                 if (method === "get" || method === "delete") {
                    const paramsConfig = `params: ${newDataString}, `;
                    axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`, { ${paramsConfig}cancelToken: source.token })`;
                 } else {
                    axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`, ${newDataString}, { cancelToken: source.token })`;
                 }
             } else {
                 // If no pageNo detected, maybe just pass it? Unlikely for infinite query but safe fallback
                 // Or we inject it?
                  if (method === "get" || method === "delete") {
                    const paramsConfig =
                        dataVars.length > 0 ? `params: ${dataString}, ` : "";
                    axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`, { ${paramsConfig}cancelToken: source.token })`;
                 } else {
                    axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`, ${dataString}, { cancelToken: source.token })`;
                 }
             }
        } else {
             if (method === "get" || method === "delete") {
                const paramsConfig =
                    dataVars.length > 0 ? `params: ${dataString}, ` : "";
                axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`, { ${paramsConfig}cancelToken: source.token })`;
             } else {
                axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`, ${dataString}, { cancelToken: source.token })`;
             }
        }

        let internalReturnType = apiReturnType;
        let returnBlock = "return response.data;";
        
        if (wrapperArgs) {
            internalReturnType = `${wrapperArgs}<${apiReturnType}>`;
            returnBlock = `if (response.data.success !== true) {
      return Promise.reject('Something went wrong!');
    }
    return response.data?.data;`;
        }

        apiFunction = `export const ${apiFunctionName} = async (
  context: QueryFunctionContext<ReturnType<typeof ${queryKeyName}.keys>>
): Promise<${apiReturnType}> => {
  const { signal, queryKey } = context;
  const { ${destructureString} } = queryKey[0];
${hookType === "useInfiniteQuery" ? "  const { pageParam } = context;" : ""}

  const { CancelToken } = axios;
  const source = CancelToken.source();
  signal?.addEventListener('abort', () => {
    source.cancel(\`${processedApiUrl} - Request cancelled\`);
  });

  try {
    const response: AxiosResponse<${internalReturnType}> =
      ${axiosCall};
    ${returnBlock}
  } catch (e) {
    return Promise.reject(((e as any).response as AxiosResponse) ?? e);
  }
};`;
    } else {
        const method = httpMethod;
        let axiosCall = "";
        const dataVars = bodyParams;
        const dataString =
            dataVars.length > 0 ? `, { ${dataVars.join(", ")} }` : "";

        if (method === "get" || method === "delete") {
            axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`${dataString})`;
        } else {
            axiosCall = `await getInstance().${method}(\`${processedApiUrl}\`${dataString})`;
        }

        let internalReturnType = apiReturnType;
        let returnBlock = "return response.data;";
        
        if (wrapperArgs) {
            internalReturnType = `${wrapperArgs}<${apiReturnType}>`;
            returnBlock = `if (response.data.success !== true) {
      return Promise.reject('Something went wrong!');
    }
    return response.data?.data;`;
        }

        apiFunction = `export const ${apiFunctionName} = async (${apiArgsRaw}${apiArgsTyped}): Promise<${apiReturnType}> => {
  try {
    const response: AxiosResponse<${internalReturnType}> =
      ${axiosCall};
    ${returnBlock}
  } catch (e) {
    return Promise.reject((e as AxiosError).response ?? e);
  }
};`;
    }

    let queryKeyDefinition = "";

    // New logic for Query Key Definition to support object arguments with type safety
    const hasVariables = paramsSchema ? true : Object.keys(paramsJson).length > 0;

    if (hookType !== 'useMutation') {
        
        // Construct Query Key Args Type
        let queryKeyArgsType = `{ scope: '${camelName}' }`;
        
        if (hasVariables) {
            queryKeyArgsType += ` & ${variablesInterfaceName}`;
        }
    
        queryKeyDefinition = `export const ${queryKeyName} = {
      keys: (args: ${queryKeyArgsType}) => [args] as const,
    };`;
    }

    const hookName = `use${pascalName}`;
    let hookBody = "";

    if (hookType === "useQuery") {
        let allVars: string[] = [];
        if (paramsSchema) {
             try {
                const parsed = JSON.parse(paramsSchema);
                 if (parsed.properties) {
                     allVars = [...new Set([...urlVars, ...Object.keys(parsed.properties)])];
                } else { allVars = urlVars; }
             } catch(e) { allVars = urlVars; }
        } else {
             allVars = [...new Set([...urlVars, ...Object.keys(paramsJson)])];
        }
        const extraHookOptions = `options?: { enabled?: boolean }`;
        
        // Destructure arguments for the hook
        let hookDestructure = "";
        let hookPropsType = "";
        
        if (hasVariables) {
             hookPropsType = `${variablesInterfaceName} & { ${extraHookOptions} }`;
        } else {
             hookPropsType = `{ ${extraHookOptions} }`;
        }
        
        if (allVars.length > 0) {
           const mapping = getUniqueVarMapping(allVars);
           hookDestructure = `{ ${mapping.map(m => m.key === m.safe ? m.key : `${JSON.stringify(m.key)}: ${m.safe}`).join(", ")}, options }`;
        } else {
           hookDestructure = `{ options }`;
        }

        // Arguments for QueryKey.keys()
        let keysObject = `scope: '${camelName}'`;
        if (allVars.length > 0) {
             const mapping = getUniqueVarMapping(allVars); // Re-gen mapping, identical result order
             keysObject += `, ${mapping.map(m => m.key === m.safe ? m.key : `${JSON.stringify(m.key)}: ${m.safe}`).join(", ")}`;
        }

        const queryFn = apiFunctionName;

        hookBody = `export const ${hookName} = (${hookDestructure}: ${hookPropsType}) => {
  const response = useQuery(
    ${queryKeyName}.keys({
      ${keysObject}
    }),
    ${queryFn},
    {
      ...options
    }
  );
  return response;
};`;

    } else if (hookType === "useInfiniteQuery") {
         let allVars: string[] = [];
         if (paramsSchema) {
              try {
                const parsed = JSON.parse(paramsSchema);
                 if (parsed.properties) {
                     allVars = [...new Set([...urlVars, ...Object.keys(parsed.properties)])];
                } else { allVars = urlVars; }
             } catch(e) { allVars = urlVars; }
         } else {
             allVars = [...new Set([...urlVars, ...Object.keys(paramsJson)])];
         }
         const extraHookOptions = `options?: { enabled?: boolean }`;
         
         let hookPropsType = "";
         if (hasVariables) {
              hookPropsType = `${variablesInterfaceName} & { ${extraHookOptions} }`;
         } else {
              hookPropsType = `{ ${extraHookOptions} }`;
         }
         
         let hookDestructure = "";
         if (allVars.length > 0) {
            const mapping = getUniqueVarMapping(allVars);
            hookDestructure = `{ ${mapping.map(m => m.key === m.safe ? m.key : `${JSON.stringify(m.key)}: ${m.safe}`).join(", ")}, options }`;
         } else {
            hookDestructure = `{ options }`;
         }
 
         let keysObject = `scope: '${camelName}'`;
         if (allVars.length > 0) {
              const mapping = getUniqueVarMapping(allVars);
              keysObject += `, ${mapping.map(m => m.key === m.safe ? m.key : `${JSON.stringify(m.key)}: ${m.safe}`).join(", ")}`;
         }
 
         const queryFn = apiFunctionName;
 
         hookBody = `export const ${hookName} = (${hookDestructure}: ${hookPropsType}) => {
   const queryData = useInfiniteQuery(
     ${queryKeyName}.keys({
       ${keysObject}
     }),
     ${queryFn},
     {
       getNextPageParam: (lastPage: any, pages: any) => {
         const totalRecordsFetched = pages.reduce((prev: number, one: any) => {
           return prev + (one?.data?.length || 0); 
         }, 0);
         
         if (lastPage?.totalRecords !== undefined && totalRecordsFetched < lastPage.totalRecords) {
           return pages.length + 1;
         }
         if (lastPage?.filteredRecords !== undefined && totalRecordsFetched < lastPage.filteredRecords) {
            return pages.length + 1;
         }
         return null;
       },
       onError: (e: AxiosResponse<any>) => {
         // showSnackbarOnApiError(e); // Optional
       },
       enabled: options?.enabled,
     }
   );
   return queryData;
 };`;
 
     } else if (hookType === "useMutation") {
         // mutationKey logic removed


        hookBody = `export const ${hookName} = (options?: {
  onSuccess?: (
    data: ${apiReturnType},
    variables: ${variablesType},
    context: unknown
  ) => void;
  onError?: (error: AxiosResponse) => void;
}) => {
  const invalidateQueries = useInvalidateCommonQueries();
  return useMutation({
    mutationFn: ${apiFunctionName},
    onSuccess: (...args) => {
      invalidateQueries();
      options?.onSuccess?.(...args);
    },
    onError: (error: AxiosResponse) => {
      showSnackbarOnApiError(error);
      options?.onError?.(error);
    },
  });
};`;
    } else {
        const hookArgs =
            variablesCode && variablesCode.trim() !== ""
                ? `variables: ${pascalName}Variables, options?: UseQueryOptions<${apiReturnType}>`
                : `options?: UseQueryOptions<${apiReturnType}>`;

        const queryFn = apiFunctionName;

        let keysCall = `${queryKeyName}.keys({ scope: '${camelName}' })`;
        if (variablesCode && variablesCode.trim() !== "") {
            keysCall = `${queryKeyName}.keys({ scope: '${camelName}', ...variables })`;
        }

        hookBody = `export const ${hookName} = (${hookArgs}) => {
  return useQuery({
    queryKey: ${keysCall},
    queryFn: ${queryFn},
    ...options
  });
};`;
    }

    return {
        model: [variablesDefinition, responseModel]
            .filter(Boolean)
            .join("\n\n"),
        api: apiFunction,
        queryKey: queryKeyDefinition,
        hook: hookBody,
    };
}
