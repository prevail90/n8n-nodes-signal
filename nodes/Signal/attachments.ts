import { IExecuteFunctions, INodeExecutionData, NodeApiError } from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';
import axios from 'axios';

interface SignalApiErrorResponse {
    error?: string;
}

interface OperationParams {
    attachmentId?: string;
    timeout: number;
    apiUrl: string;
    apiToken: string;
    phoneNumber: string;
}

export async function executeAttachmentsOperation(
    this: IExecuteFunctions,
    operation: string,
    itemIndex: number,
    params: OperationParams,
): Promise<INodeExecutionData> {
    const { attachmentId, timeout, apiUrl, apiToken, phoneNumber } = params;

    const axiosConfig: AxiosRequestConfig = {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        timeout,
        responseType: operation === 'downloadAttachment' ? 'arraybuffer' : 'json',
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
        if (operation === 'listAttachments') {
            const response = await retryRequest(() =>
                axios.get(`${apiUrl}/v1/attachments/${phoneNumber}`, axiosConfig)
            );
            return { json: response.data, pairedItem: { item: itemIndex } };
        } else if (operation === 'downloadAttachment') {
            if (!attachmentId) {
                throw new NodeApiError(this.getNode(), { message: 'Attachment ID is required' });
            }
            const endpoint = `${apiUrl}/v1/attachments/${attachmentId}`;
            this.logger.debug(`Attachments: Downloading from endpoint: ${endpoint}`);
            
            const response = await retryRequest(() =>
                axios.get(endpoint, axiosConfig)
            );
            
            this.logger.debug(`Attachments: Download response size: ${response.data.byteLength}, content-type: ${response.headers['content-type']}`);
            
            if (!response.data || response.data.byteLength === 0) {
                this.logger.warn(`Attachments: Empty response data for attachment ${attachmentId}`);
                return { json: { status: 'Empty attachment' }, pairedItem: { item: itemIndex } };
            }

            const contentType = response.headers['content-type'] || 'application/octet-stream';
            const contentDisposition = response.headers['content-disposition'] || '';
            const fileName = contentDisposition.match(/filename="(.+)"/)?.[1] || `attachment_${attachmentId}`;
            
            // Конвертуємо ArrayBuffer в Buffer для n8n
            const buffer = Buffer.from(response.data);
            
            this.logger.debug(`Attachments: Created buffer of size: ${buffer.length}`);
            
            return { 
                json: { 
                    fileName,
                    mimeType: contentType,
                    size: buffer.length,
                    attachmentId 
                }, 
                binary: { 
                    attachment: {
                        data: buffer.toString('base64'),
                        mimeType: contentType,
                        fileName: fileName,
                        fileExtension: fileName.split('.').pop() || ''
                    }
                }, 
                pairedItem: { item: itemIndex } 
            };
        } else if (operation === 'removeAttachment') {
            if (!attachmentId) {
                throw new NodeApiError(this.getNode(), { message: 'Attachment ID is required' });
            }
            const response = await retryRequest(() =>
                axios.delete(`${apiUrl}/v1/attachments/${attachmentId}`, axiosConfig)
            );
            return { json: response.data || { status: 'Attachment removed' }, pairedItem: { item: itemIndex } };
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