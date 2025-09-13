import {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    NodeConnectionType,
    NodeApiError,
} from 'n8n-workflow';
import { AxiosError } from 'axios';
import axios from 'axios';

// Інтерфейс для відповіді API, щоб обробляти помилки
interface SignalApiErrorResponse {
    error?: string;
}

export class Signal implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Signal',
        name: 'signal',
        icon: 'file:signal.svg', // Потрібно створити іконку
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
            if (operation === 'sendMessage') {
                const recipient = this.getNodeParameter('recipient', i) as string;
                const message = this.getNodeParameter('message', i) as string;

                try {
                    const response = await axios.post(
                        `${apiUrl}/v1/send`,
                        {
                            message,
                            number: phoneNumber,
                            recipients: [recipient],
                        },
                        {
                            headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
                        }
                    );

                    returnData.push({
                        json: response.data,
                        pairedItem: { item: i },
                    });
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
        }

        return [returnData];
    }
}