import { describe, expect, test, afterAll, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';

const MCP_ACCEPT_HEADER = 'application/json, text/event-stream';
const MCP_INITIALIZE_PAYLOAD = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'jest-client',
      version: '1.0.0',
    },
  },
};

const initializeMcpSession = () =>
  supertest(Server.getInstance().server)
    .post('/mcp')
    .set('Accept', MCP_ACCEPT_HEADER)
    .set('Content-Type', 'application/json')
    .send(MCP_INITIALIZE_PAYLOAD);

describe('服务器测试', () => {
  // 启动服务器测试实例
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  // 关闭服务器
  afterAll(async () => {
    await Server.getInstance().close();
  });

  test('GET /ping 应返回正确响应', async () => {
    const response = await supertest(Server.getInstance().server)
      .get('/ping')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      status: 'ok',
      message: 'pong',
    });
  });

  test('MCP 会话删除后应允许重新初始化', async () => {
    const firstInit = await initializeMcpSession().expect(200);
    const firstSessionId = firstInit.headers['mcp-session-id'];

    expect(firstSessionId).toBeTruthy();

    const deleteResponse = await supertest(Server.getInstance().server)
      .delete('/mcp')
      .set('Accept', MCP_ACCEPT_HEADER)
      .set('mcp-session-id', firstSessionId);

    expect([200, 204]).toContain(deleteResponse.status);

    const secondInit = await initializeMcpSession().expect(200);
    const secondSessionId = secondInit.headers['mcp-session-id'];

    expect(secondSessionId).toBeTruthy();
    expect(secondSessionId).not.toBe(firstSessionId);
  });
});
