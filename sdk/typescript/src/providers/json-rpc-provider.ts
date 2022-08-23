// Copyright (c) 2022, Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Provider } from './provider';
import { JsonRpcClient } from '../rpc/client';
import {
  isGetObjectDataResponse,
  isGetOwnedObjectsResponse,
  isGetTxnDigestsResponse,
  isSuiTransactionResponse,
  isSuiMoveFunctionArgTypes,
  isSuiMoveNormalizedModules,
  isSuiMoveNormalizedModule,
  isSuiMoveNormalizedFunction,
  isSuiMoveNormalizedStruct,
  isSubscriptionEvent,
} from '../index.guard';
import {
  GatewayTxSeqNumber,
  GetTxnDigestsResponse,
  GetObjectDataResponse,
  SuiObjectInfo,
  SuiMoveFunctionArgTypes,
  SuiMoveNormalizedModules,
  SuiMoveNormalizedModule,
  SuiMoveNormalizedFunction,
  SuiMoveNormalizedStruct,
  TransactionDigest,
  SuiTransactionResponse,
  SuiObjectRef,
  getObjectReference,
  Coin,
  SuiEventFilter,
  SuiEventEnvelope,
  SubscriptionId,
} from '../types';
import { SignatureScheme } from '../cryptography/publickey';
import { Client as WsRpcClient} from 'rpc-websockets';

const isNumber = (val: any): val is number => typeof val === 'number';
const isAny = (_val: any): _val is any => true;

const httpRegex = new RegExp('^http');
const portRegex = new RegExp(':[0-9]{1,5}$');
export const getWebsocketUrl = (httpUrl: string, port?: number): string => {
  let wsUrl = httpUrl.replace(httpRegex, 'ws');
  wsUrl = wsUrl.replace(portRegex, '');
  return `${wsUrl}:${port ?? 9001}`;    // 9001 is full node websocket
};

enum ConnectionState {
  NotConnected,
  Connecting,
  Connected
}

export type SubscriptionEvent = { subscription: SubscriptionId, result: SuiEventEnvelope };

export class JsonRpcProvider extends Provider {
  private client: JsonRpcClient;
  private wsClient: WsRpcClient;
  private wsConnectionState: ConnectionState = ConnectionState.NotConnected;
  private wsEndpoint: string;

  private activeSubscriptions: Map<SubscriptionId, (event: SuiEventEnvelope) => any> = new Map();

  /**
   * Establish a connection to a Sui Gateway endpoint
   *
   * @param endpoint URL to the Sui Gateway endpoint
   */
  constructor(public endpoint: string) {
    super();

    console.log('JsonProvider constructor()')
    this.client = new JsonRpcClient(endpoint);
    this.wsEndpoint = getWebsocketUrl(endpoint);
    this.wsClient = new WsRpcClient(this.wsEndpoint, { reconnect_interval: 3000 })

    this.wsClient.connect();
    this.wsConnectionState = ConnectionState.Connecting;

    this.wsClient.on('open', () => {
      this.wsConnectionState = ConnectionState.Connected;

      this.wsClient.on('close', () => {
        console.log('connection closed');
        this.wsConnectionState = ConnectionState.NotConnected;
      });

      this.wsClient.on('message', this.onMessage);
      console.log('ws connection opened');
    });

    this.wsClient.on('message', this.onMessage);
    this.wsClient.on('error', console.error);
  }

  private onMessage(msg: any): void {
    console.log('socket message received', msg);

    if(isSubscriptionEvent(msg)) {
      // call any registered handler for the message's subscription
      const onMessage = this.activeSubscriptions.get(msg.subscription);
      if (onMessage) {
        onMessage(msg.result);
        console.log(`call onMessage(), subscription ${msg.subscription}`);
      }
    }
  }

  // Move info
  async getMoveFunctionArgTypes(
    objectId: string,
    moduleName: string,
    functionName: string
  ): Promise<SuiMoveFunctionArgTypes> {
    try {
      return await this.client.requestWithType(
        'sui_getMoveFunctionArgTypes',
        [objectId, moduleName, functionName],
        isSuiMoveFunctionArgTypes
      );
    } catch (err) {
      throw new Error(
        `Error fetching Move function arg types with package object ID: ${objectId}, module name: ${moduleName}, function name: ${functionName}`
      );
    }
  }

  async getNormalizedMoveModulesByPackage(objectId: string,): Promise<SuiMoveNormalizedModules> {
    try {
      return await this.client.requestWithType(
        'sui_getNormalizedMoveModulesByPackage',
        [objectId],
        isSuiMoveNormalizedModules,
      );
    } catch (err) {
      throw new Error(`Error fetching package: ${err} for package ${objectId}`);
    }
  }

  async getNormalizedMoveModule(
    objectId: string,
    moduleName: string,
  ): Promise<SuiMoveNormalizedModule> {
    try {
      return await this.client.requestWithType(
        'sui_getNormalizedMoveModule',
        [objectId, moduleName],
        isSuiMoveNormalizedModule,
      );
    } catch (err) {
      throw new Error(`Error fetching module: ${err} for package ${objectId}, module ${moduleName}}`);
    }
  }

  async getNormalizedMoveFunction(
    objectId: string,
    moduleName: string,
    functionName: string
  ): Promise<SuiMoveNormalizedFunction> {
    try {
      return await this.client.requestWithType(
        'sui_getNormalizedMoveFunction',
        [objectId, moduleName, functionName],
        isSuiMoveNormalizedFunction,
      );
    } catch (err) {
      throw new Error(`Error fetching function: ${err} for package ${objectId}, module ${moduleName} and function ${functionName}}`);
    }
  }

  async getNormalizedMoveStruct(
    objectId: string,
    moduleName: string,
    structName: string
  ): Promise<SuiMoveNormalizedStruct> {
    try {
      return await this.client.requestWithType(
        'sui_getNormalizedMoveStruct',
        [objectId, moduleName, structName],
        isSuiMoveNormalizedStruct,
      );
    } catch (err) {
      throw new Error(`Error fetching struct: ${err} for package ${objectId}, module ${moduleName} and struct ${structName}}`);
    }
  }

  // Objects
  async getObjectsOwnedByAddress(address: string): Promise<SuiObjectInfo[]> {
    try {
      return await this.client.requestWithType(
        'sui_getObjectsOwnedByAddress',
        [address],
        isGetOwnedObjectsResponse
      );
    } catch (err) {
      throw new Error(
        `Error fetching owned object: ${err} for address ${address}`
      );
    }
  }

  async getGasObjectsOwnedByAddress(address: string): Promise<SuiObjectInfo[]> {
    const objects = await this.getObjectsOwnedByAddress(address);
    return objects.filter((obj: SuiObjectInfo) => Coin.isSUI(obj));
  }

  async getObjectsOwnedByObject(objectId: string): Promise<SuiObjectInfo[]> {
    try {
      return await this.client.requestWithType(
        'sui_getObjectsOwnedByObject',
        [objectId],
        isGetOwnedObjectsResponse
      );
    } catch (err) {
      throw new Error(
        `Error fetching owned object: ${err} for objectId ${objectId}`
      );
    }
  }

  async getObject(objectId: string): Promise<GetObjectDataResponse> {
    try {
      return await this.client.requestWithType(
        'sui_getObject',
        [objectId],
        isGetObjectDataResponse
      );
    } catch (err) {
      throw new Error(`Error fetching object info: ${err} for id ${objectId}`);
    }
  }

  async getObjectRef(objectId: string): Promise<SuiObjectRef | undefined> {
    const resp = await this.getObject(objectId);
    return getObjectReference(resp);
  }

  async getObjectBatch(objectIds: string[]): Promise<GetObjectDataResponse[]> {
    const requests = objectIds.map(id => ({
      method: 'sui_getObject',
      args: [id],
    }));
    try {
      return await this.client.batchRequestWithType(
        requests,
        isGetObjectDataResponse
      );
    } catch (err) {
      throw new Error(`Error fetching object info: ${err} for id ${objectIds}`);
    }
  }

  // Transactions

  async getTransactionsForObject(
    objectID: string
  ): Promise<GetTxnDigestsResponse> {
    const requests = [
      {
        method: 'sui_getTransactionsByInputObject',
        args: [objectID],
      },
      {
        method: 'sui_getTransactionsByMutatedObject',
        args: [objectID],
      },
    ];

    try {
      const results = await this.client.batchRequestWithType(
        requests,
        isGetTxnDigestsResponse
      );
      return [...results[0], ...results[1]];
    } catch (err) {
      throw new Error(
        `Error getting transactions for object: ${err} for id ${objectID}`
      );
    }
  }

  async getTransactionsForAddress(
    addressID: string
  ): Promise<GetTxnDigestsResponse> {
    const requests = [
      {
        method: 'sui_getTransactionsToAddress',
        args: [addressID],
      },
      {
        method: 'sui_getTransactionsFromAddress',
        args: [addressID],
      },
    ];

    try {
      const results = await this.client.batchRequestWithType(
        requests,
        isGetTxnDigestsResponse
      );
      return [...results[0], ...results[1]];
    } catch (err) {
      throw new Error(
        `Error getting transactions for address: ${err} for id ${addressID}`
      );
    }
  }

  async getTransactionWithEffects(
    digest: TransactionDigest
  ): Promise<SuiTransactionResponse> {
    try {
      const resp = await this.client.requestWithType(
        'sui_getTransaction',
        [digest],
        isSuiTransactionResponse
      );
      return resp;
    } catch (err) {
      throw new Error(
        `Error getting transaction with effects: ${err} for digest ${digest}`
      );
    }
  }

  async getTransactionWithEffectsBatch(
    digests: TransactionDigest[]
  ): Promise<SuiTransactionResponse[]> {
    const requests = digests.map(d => ({
      method: 'sui_getTransaction',
      args: [d],
    }));
    try {
      return await this.client.batchRequestWithType(
        requests,
        isSuiTransactionResponse
      );
    } catch (err) {
      const list = digests.join(', ').substring(0, -2);
      throw new Error(
        `Error getting transaction effects: ${err} for digests [${list}]`
      );
    }
  }

  async executeTransaction(
    txnBytes: string,
    signatureScheme: SignatureScheme,
    signature: string,
    pubkey: string
  ): Promise<SuiTransactionResponse> {
    try {
      const resp = await this.client.requestWithType(
        'sui_executeTransaction',
        [txnBytes, signatureScheme, signature, pubkey],
        isSuiTransactionResponse
      );
      return resp;
    } catch (err) {
      throw new Error(`Error executing transaction: ${err}}`);
    }
  }

  async getTotalTransactionNumber(): Promise<number> {
    try {
      const resp = await this.client.requestWithType(
        'sui_getTotalTransactionNumber',
        [],
        isNumber
      );
      return resp;
    } catch (err) {
      throw new Error(`Error fetching total transaction number: ${err}`);
    }
  }

  async getTransactionDigestsInRange(
    start: GatewayTxSeqNumber,
    end: GatewayTxSeqNumber
  ): Promise<GetTxnDigestsResponse> {
    try {
      return await this.client.requestWithType(
        'sui_getTransactionsInRange',
        [start, end],
        isGetTxnDigestsResponse
      );
    } catch (err) {
      throw new Error(
        `Error fetching transaction digests in range: ${err} for range ${start}-${end}`
      );
    }
  }

  async getRecentTransactions(count: number): Promise<GetTxnDigestsResponse> {
    try {
      return await this.client.requestWithType(
        'sui_getRecentTransactions',
        [count],
        isGetTxnDigestsResponse
      );
    } catch (err) {
      throw new Error(
        `Error fetching recent transactions: ${err} for count ${count}`
      );
    }
  }

  async syncAccountState(address: string): Promise<any> {
    try {
      return await this.client.requestWithType(
        'sui_syncAccountState',
        [address],
        isAny
      );
    } catch (err) {
      throw new Error(
        `Error sync account address for address: ${address} with error: ${err}`
      );
    }
  }

  async subscribeEvent(
    filter: SuiEventFilter,
    onMessage: (event: SuiEventEnvelope) => void
  ): Promise<SubscriptionId> {
    try {
      if (this.wsConnectionState != ConnectionState.Connected)
        throw new Error('websocket not connected');

      let subId = await this.wsClient.call(
        'sui_subscribeEvent',
        [filter],
        30000
      ) as SubscriptionId;

      this.activeSubscriptions.set(subId, onMessage);
      console.log('sub id', subId, onMessage, this.activeSubscriptions, this.wsClient.eventNames());
      return subId;
    } catch (err) {
      throw new Error(
        `Error subscribing to event: ${err}, filter: ${JSON.stringify(filter)}`
      );
    }
  }

  unsubscribeEvent(id: SubscriptionId): boolean {
    return this.activeSubscriptions.delete(id);
  }
}
