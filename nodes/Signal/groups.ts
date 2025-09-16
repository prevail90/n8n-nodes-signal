import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';
import axios from 'axios';

interface SignalApiErrorResponse {
    error?: string;
}

interface OperationParams {
    groupName?: string;
    groupMembers?: string;
    groupId?: string;
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeGroupsOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { groupName, groupMembers, groupId, timeout, apiUrl, apiToken, phoneNumber } = params;

    const axiosConfig: AxiosRequestConfig = {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        timeout,
    };

    const retryRequest = async (request: () => Promise<any>, retries = 2, delay = 5000): Promise<any> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await request();
            } catch (error) {
                if (attempt === retries) throw error;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    };

    try {
        if (operation === 'getGroups') {
            const response = await retryRequest(() =>
                axios.get(`${apiUrl}/v1/groups/${phoneNumber}`, axiosConfig)
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        } else if (operation === 'createGroup') {
            const members = groupMembers?.split(',').map(member => member.trim()) || [];
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/groups/${phoneNumber}`,
                    {
                        name: groupName,
                        members,
                    },
                    axiosConfig
                )
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        } else if (operation === 'updateGroup') {
            const body: { name?: string; members?: string[] } = {};
            if (groupName) body.name = groupName;
            if (groupMembers) body.members = groupMembers.split(',').map(member => member.trim());
            const response = await retryRequest(() =>
                axios.put(
                    `${apiUrl}/v1/groups/${phoneNumber}/${groupId}`,
                    body,
                    axiosConfig
                )
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        }
        throw new NodeApiError(this.getNode(), { message: 'Unknown operation' });
    } catch (error) {
        const axiosError = error as AxiosError<SignalApiErrorResponse>;
        throw new NodeApiError(this.getNode(), {
            message: axiosError.message,
            description: (axiosError.response?.data?.error || axiosError.message) as string,
            httpCode: axiosError.response?.status?.toString() || 'unknown',
        }, { itemIndex });
    }
}