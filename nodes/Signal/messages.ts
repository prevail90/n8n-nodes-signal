import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';
import axios from 'axios';

interface SignalApiErrorResponse {
    error?: string;
}

interface OperationParams {
    recipient?: string;
    message?: string;
    attachmentUrl?: string;
    emoji?: string;
    targetAuthor?: string;
    targetSentTimestamp?: number;
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeMessagesOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { recipient, message, attachmentUrl, emoji, targetAuthor, targetSentTimestamp, timeout, apiUrl, apiToken, phoneNumber } = params;

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
        if (operation === 'sendMessage') {
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/send`,
                    {
                        message,
                        number: phoneNumber,
                        recipients: [recipient],
                    },
                    axiosConfig
                )
            );
            return { json: response.data || { status: 'Message sent' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'sendAttachment') {
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/send`,
                    {
                        message,
                        number: phoneNumber,
                        recipients: [recipient],
                        attachments: [attachmentUrl],
                    },
                    axiosConfig
                )
            );
            return { json: response.data || { status: 'Attachment sent' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'sendReaction') {
            const response = await retryRequest(() =>
                axios.post(
                    `${apiUrl}/v1/reactions/${phoneNumber}`,
                    {
                        reaction: emoji,
                        recipient,
                        target_author: targetAuthor,
                        timestamp: targetSentTimestamp,
                    },
                    axiosConfig
                )
            );
            return { json: response.data || { status: 'Reaction sent' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'removeReaction') {
            const response = await retryRequest(() =>
                axios.delete(
                    `${apiUrl}/v1/reactions/${phoneNumber}`,
                    {
                        ...axiosConfig,
                        data: {
                            recipient,
                            target_author: targetAuthor,
                            timestamp: targetSentTimestamp,
                        },
                    }
                )
            );
            return { json: response.data || { status: 'Reaction removed' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'startTyping') {
            const response = await retryRequest(() =>
                axios.put(
                    `${apiUrl}/v1/typing-indicator/${phoneNumber}`,
                    {
                        recipient,
                        action: "start",
                    },
                    axiosConfig
                )
            );
            return { 
                json: { 
                    status: 'Typing indicator started', 
                    recipient, 
                    action: 'start',
                    timestamp: new Date().toISOString(),
                    ...response.data
                }, 
                pairedItem: { item: itemIndex } 
            };
        } else if (operation === 'stopTyping') {
            const response = await retryRequest(() =>
                axios.put(
                    `${apiUrl}/v1/typing-indicator/${phoneNumber}`,
                    {
                        recipient,
                        action: "stop",
                    },
                    axiosConfig
                )
            );
            return { 
                json: { 
                    status: 'Typing indicator stopped', 
                    recipient, 
                    action: 'stop',
                    timestamp: new Date().toISOString(),
                    ...response.data
                }, 
                pairedItem: { item: itemIndex } 
            };
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