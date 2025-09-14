import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionType,
    NodeApiError,
} from 'n8n-workflow';
import { AxiosError, AxiosRequestConfig } from 'axios';
import axios from 'axios';

interface SignalApiErrorResponse {
    error?: string;
}

export class Signal implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Signal',
        name: 'signal',
        icon: 'file:signal.svg',
        group: ['output'],
        version: 1,
        description: 'Interact with Signal via signal-cli-rest-api',
        defaults: {
            name: 'Signal',
        },
        inputs: [NodeConnectionType.Main],
        outputs: [NodeConnectionType.Main],
        credentials: [
            {
                name: 'signalApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                default: 'sendMessage',
                options: [
                    {
                        name: 'Send Message',
                        value: 'sendMessage',
                        description: 'Send a message to a contact or group',
                        action: 'Send a message',
                    },
                    {
                        name: 'Get Contacts',
                        value: 'getContacts',
                        description: 'Get the list of contacts for the account',
                        action: 'Get contacts',
                    },
                    {
                        name: 'Get Groups',
                        value: 'getGroups',
                        description: 'Get the list of groups for the account',
                        action: 'Get groups',
                    },
                ],
            },
            {
                displayName: 'Recipient',
                name: 'recipient',
                type: 'string',
                default: '',
                placeholder: '+1234567890 or groupId',
                description: 'Phone number or group ID to send the message to',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendMessage'],
                    },
                },
            },
            {
                displayName: 'Message',
                name: 'message',
                type: 'string',
                default: '',
                description: 'The message to send',
                required: true,
                displayOptions: {
                    show: {
                        operation: ['sendMessage'],
                    },
                },
            },
            {
                displayName: 'Timeout (seconds)',
                name: 'timeout',
                type: 'number',
                default: 60,
                description: 'Request timeout in seconds (set higher for Get Groups, e.g., 300)',
                displayOptions: {
                    show: {
                        operation: ['sendMessage', 'getContacts', 'getGroups'],
                    },
                },
                typeOptions: {
                    minValue: 1,
                    maxValue: 600,
                },
                hint: 'Increase for slow operations like Get Groups (recommended: 300 for Get Groups)',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const operation = this.getNodeParameter('operation', 0) as string;

        const credentials = await this.getCredentials('signalApi');
        const apiUrl = credentials.apiUrl as string;
        const apiToken = credentials.apiToken as string;
        const phoneNumber = credentials.phoneNumber as string;

        for (let i = 0; i < items.length; i++) {
            // Отримуємо таймаут із параметрів (у секундах, конвертуємо в мс)
            const timeout = (this.getNodeParameter('timeout', i, operation === 'getGroups' ? 300 : 60) as number) * 1000;

            // Налаштування axios з таймаутом
            const axiosConfig: AxiosRequestConfig = {
                headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
                timeout,
            };

            // Retry-логіка
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
                    const recipient = this.getNodeParameter('recipient', i) as string;
                    const message = this.getNodeParameter('message', i) as string;

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

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                } else if (operation === 'getContacts') {
                    const response = await retryRequest(() =>
                        axios.get(`${apiUrl}/v1/contacts/${phoneNumber}`, axiosConfig)
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                } else if (operation === 'getGroups') {
                    const response = await retryRequest(() =>
                        axios.get(`${apiUrl}/v1/groups/${phoneNumber}`, axiosConfig)
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
                }
            } catch (error) {
                const axiosError = error as AxiosError<SignalApiErrorResponse>;
                throw new NodeApiError(this.getNode(), {
                    message: axiosError.message,
                    description: (axiosError.response?.data?.error || axiosError.message) as string,
                    httpCode: axiosError.response?.status?.toString() || 'unknown',
                }, {
                    itemIndex: i,
                });
            }
        }

        return [returnData];
    }
}