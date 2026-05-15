#!/bin/bash
# Workflow 执行监控脚本
# 用法: ./scripts/monitor-workflow.sh [run_id]

RUN_ID=$1
LOG_FILE=~/.hermes/logs/agent.log

if [ -z "$RUN_ID" ]; then
    echo "用法: $0 <run_id>"
    echo "示例: $0 run_6705b5234a674ea990025705fc19329f"
    echo ""
    echo "最近的 workflow 执行："
    grep "conversation turn.*workflow" $LOG_FILE | tail -5 | sed 's/.*session=\([^ ]*\).*/\1/'
    exit 1
fi

echo "=== Workflow 执行监控: $RUN_ID ==="
echo ""

# 提取该 run 的所有工具调用
echo "## 工具调用时间线"
grep "\[$RUN_ID\].*tool.*completed" $LOG_FILE | \
    sed 's/.*INFO \[\(run_[^]]*\)\] run_agent: tool \([^ ]*\) completed (\([^,]*\), \([^)]*\)).*/\2: \3 (\4)/' | \
    nl

echo ""
echo "## API 调用统计"
grep "\[$RUN_ID\].*API call" $LOG_FILE | \
    sed 's/.*API call #\([0-9]*\):.*in=\([0-9]*\) out=\([0-9]*\) total=\([0-9]*\) latency=\([^ ]*\) cache=\([^ ]*\).*/Call #\1: in=\2 out=\3 total=\4 latency=\5 cache=\6/' | \
    tail -20

echo ""
echo "## 执行结果"
grep "\[$RUN_ID\].*Turn ended" $LOG_FILE | \
    sed 's/.*Turn ended: //'
