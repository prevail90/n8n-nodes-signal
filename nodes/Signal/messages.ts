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
    inputBinaryField?: string;
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
    const { recipient, message, attachmentUrl, emoji, targetAuthor, targetSentTimestamp, inputBinaryField, timeout, apiUrl, apiToken, phoneNumber } = params;

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
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for sending a message',
                }, { itemIndex });
            }

            const body: { message?: string; number: string; recipients: string[]; base64_attachments?: string[] } = {
                message,
                number: phoneNumber,
                recipients: [recipient],
            };

            // Handle binary attachments if inputBinaryField is specified and valid
            if (inputBinaryField) {
                const binary = this.getInputData()[itemIndex].binary;
                if (!binary || !binary[inputBinaryField]) {
                    throw new NodeApiError(this.getNode(), {
                        message: `Binary data not found for field '${inputBinaryField}'`,
                    }, { itemIndex });
                }

                const binaryData = binary[inputBinaryField];
                // Validate binary data
                if (!binaryData.data || binaryData.data.length === 0) {
                    throw new NodeApiError(this.getNode(), {
                        message: `Binary data in field '${inputBinaryField}' is empty`,
                    }, { itemIndex });
                }

                // Check file size (Signal limit: 100MB)
                const maxFileSizeBytes = 99 * 1024 * 1024; // 99MB to be safe
                const binaryBuffer = Buffer.from(binaryData.data, 'base64');
                if (binaryBuffer.length > maxFileSizeBytes) {
                    throw new NodeApiError(this.getNode(), {
                        message: `File size exceeds Signal's 100MB limit (size: ${(binaryBuffer.length / (1024 * 1024)).toFixed(2)}MB). See https://support.signal.org/hc/en-us/articles/360007320391-What-kinds-of-files-can-I-send`,
                    }, { itemIndex });
                }

                // Convert binary data to base64
                const base64Data = binaryBuffer.toString('base64');
                const mimeType = binaryData.mimeType || 'application/octet-stream';
                const fileName = binaryData.fileName || `attachment_${itemIndex}`;
                
                // Use plain base64 string as per documentation
                body.base64_attachments = [base64Data];
                this.logger.debug(`Signal: Added base64 attachment for item ${itemIndex}: ${fileName}, MIME: ${mimeType}, Size: ${binaryBuffer.length} bytes`);
                this.logger.debug(`Signal: Attachment base64 length: ${base64Data.length} characters`);
            }

            // Use /v2/send if base64_attachments are present, otherwise /v1/send
            const endpoint = body.base64_attachments ? `${apiUrl}/v2/send` : `${apiUrl}/v1/send`;
            this.logger.debug(`Signal: Sending request to ${endpoint} with body: ${JSON.stringify(body, null, 2)}`);
            const response = await retryRequest(() =>
                axios.post(endpoint, body, axiosConfig)
            );
            this.logger.debug(`Signal: Response: ${JSON.stringify(response.data, null, 2)}`);
            return { json: response.data || { status: 'Message sent' }, pairedItem: { item: itemIndex } };
        } else if (operation === 'sendAttachment') {
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for sending an attachment',
                }, { itemIndex });
            }
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
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for sending a reaction',
                }, { itemIndex });
            }
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
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for removing a reaction',
                }, { itemIndex });
            }
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
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for starting typing indicator',
                }, { itemIndex });
            }
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
            if (!recipient) {
                throw new NodeApiError(this.getNode(), {
                    message: 'Recipient is required for stopping typing indicator',
                }, { itemIndex });
            }
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