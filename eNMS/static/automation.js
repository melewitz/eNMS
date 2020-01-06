/*
global
action: true
CodeMirror: false
currentPath: true
diffview: false
JSONEditor: false
jsPanel: false
page: false
serviceTypes: false
workflow: true
*/

import {
  call,
  cantorPairing,
  createPanel,
  fCall,
  notify,
  showPanel,
  showTypePanel,
} from "./base.js";
import { initTable, tables } from "./table.js";
import {
  arrowHistory,
  arrowPointer,
  currentRuntime,
  getServiceState,
  switchToWorkflow,
  workflow,
} from "./workflow.js";

let automation = (window.eNMS.automation = {});

automation.openServicePanel = function() {
  showTypePanel($("#service-type").val());
};

automation.compare = function(type) {
  const v1 = $("input[name=v1]:checked").val();
  const v2 = $("input[name=v2]:checked").val();
  if (v1 && v2) {
    const cantorId = cantorPairing(parseInt(v1), parseInt(v2));
    createPanel("compare", `Compare ${type}s`, cantorId, () => {
      call(`/compare/${type}/${v1}/${v2}`, (result) => {
        $(`#content-${cantorId}`).append(
          diffview.buildView({
            baseTextLines: result.first,
            newTextLines: result.second,
            opcodes: result.opcodes,
            baseTextName: "V1",
            newTextName: "V2",
            contextSize: null,
            viewType: 0,
          })
        );
      });
    });
  } else {
    notify("Select two versions to compare first.", "error", 5);
  }
};

function buildLinks(result, id) {
  const base = `get_result("${result.service_name}"`;
  const link = result.device_name
    ? [`Per-device result`, `${base}, device=device.name)`]
    : ["Top-level result", `${base})`];
  return `
    <div class="modal-body">
      <table
        class="table table-bordered dt-responsive nowrap"
        cellspacing="0"
        width="100%"
      >
        <tbody>
          <tr>
            <td style="text-align: center; vertical-align: middle;">
              ${link[0]}
            </td>
            <td>
              <div class="input-group" style="width: 800px">
                <input id="link-${id}" type="text" class="form-control"
                value='${link[1]}'><span class="input-group-btn">
                <button class="btn btn-default"
                onclick="eNMS.base.copyToClipboard('link-${id}', true)"
                type="button"><span class="glyphicon glyphicon-copy"></span>
                </button>
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

automation.copyClipboard = function(elementId, result) {
  const target = document.getElementById(elementId);
  if (!$(`#tooltip-${elementId}`).length) {
    jsPanel.tooltip.create({
      id: `tooltip-${elementId}`,
      content: buildLinks(result, elementId),
      contentSize: "auto",
      connector: true,
      delay: 0,
      header: false,
      mode: "sticky",
      position: {
        my: "right-top",
        at: "left-bottom",
      },
      target: target,
      ttipEvent: "click",
      theme: "light",
    });
  }
  target.click();
};

automation.showResult = function(id) {
  createPanel("result", "Result", id, function() {
    call(`/get_result/${id}`, (result) => {
      const jsonResult = result;
      const options = {
        mode: "view",
        modes: ["code", "view"],
        onModeChange: function(newMode) {
          editor.set(newMode == "code" ? result : jsonResult);
        },
        onEvent(node, event) {
          if (event.type === "click") {
            let path = node.path.map((key) =>
              typeof key == "string" ? `"${key}"` : key
            );
            $(`#result-path-${id}`).val(`results[${path.join("][")}]`);
          }
        },
      };
      let editor = new JSONEditor(
        document.getElementById(`content-${id}`),
        options,
        jsonResult
      );
      document.querySelectorAll(".jsoneditor-string").forEach((el) => {
        el.innerText = el.innerText.replace(/(?:\\n)/g, "\n");
      });
    });
  });
};

export const showRuntimePanel = (automation.showRuntimePanel = function(
  type,
  service,
  runtime,
  displayTable
) {
  const displayFunction =
    type == "logs"
      ? displayLogs
      : service.type == "workflow" && !displayTable
      ? displayResultsTree
      : displayResultsTable;
  const panelType =
    type == "logs"
      ? "logs"
      : service.type == "workflow" && !displayTable
      ? "tree"
      : "result_table";
  const panelId = `${panelType}-${service.id}`;
  call(`/get_runtimes/${type}/${service.id}`, (runtimes) => {
    if (!runtime && !runtimes.length) {
      return notify(`No ${type} yet.`, "error", 5);
    }
    createPanel(panelType, `${type} - ${service.name}`, panelId, function() {
      $(`#runtimes-${panelId}`).empty();
      runtimes.forEach((runtime) => {
        $(`#runtimes-${panelId}`).append(
          $("<option></option>")
            .attr("value", runtime[0])
            .text(runtime[1])
        );
      });
      if (!runtime || runtime == "normal") {
        runtime = runtimes[runtimes.length - 1][0];
      }
      $(`#runtimes-${panelId}`)
        .val(runtime)
        .selectpicker("refresh");
      $(`#runtimes-${panelId}`).on("change", function() {
        displayFunction(service, this.value, true);
      });
      displayFunction(service, runtime);
    });
  });
});

function displayLogs(service, runtime, change) {
  const content = document.getElementById(`content-logs-${service.id}`);
  let editor;
  if (change) {
    editor = $(`#content-logs-${service.id}`).data("CodeMirrorInstance");
    editor.setValue("");
  } else {
    // eslint-disable-next-line new-cap
    editor = CodeMirror(content, {
      lineWrapping: true,
      lineNumbers: true,
      readOnly: true,
      theme: "cobalt",
      mode: "logs",
      extraKeys: { "Ctrl-F": "findPersistent" },
      scrollbarStyle: "overlay",
    });
    $(`#content-logs-${service.id}`).data("CodeMirrorInstance", editor);
    editor.setSize("100%", "100%");
  }
  $(`#runtimes-logs-${service.id}`).on("change", function() {
    refreshLogs(service, this.value, editor);
  });
  refreshLogs(service, runtime, editor, true);
}

function displayResultsTree(service, runtime) {
  call(`/get_workflow_results/${service.id}/${runtime}`, function(data) {
    $(`#result-tree-tree-${service.id}`)
      .jstree("destroy")
      .empty();
    let tree = $(`#result-tree-tree-${service.id}`).jstree({
      core: {
        animation: 100,
        themes: { stripes: true },
        data: data,
      },
      plugins: ["html_row", "types", "wholerow"],
      types: {
        default: {
          icon: "glyphicon glyphicon-file",
        },
        workflow: {
          icon: "fa fa-sitemap",
        },
      },
      html_row: {
        default: function(el, node) {
          if (!node) return;
          const data = JSON.stringify(node.data.properties);
          let progressSummary;
          if (node.data.progress) {
            progressSummary = `
              <div style="position: absolute; top: 0px; right: 200px">
                <span style="color: #32cd32">${
                  node.data.progress.success
                } passed</span> -
                <span style="color: #FF6666">${
                  node.data.progress.failure
                } failed</span>
              </div>
            `;
          } else {
            progressSummary = "";
          }
          $(el).find("a").append(`
            ${progressSummary}
            <div style="position: absolute; top: 0px; right: 50px">
              <button type="button"
                class="btn btn-xs btn-primary"
                onclick='eNMS.automation.showRuntimePanel(
                  "logs", ${data}, "${runtime}"
                )'><span class="glyphicon glyphicon-list"></span>
              </button>
              <button type="button"
                class="btn btn-xs btn-primary"
                onclick='eNMS.automation.showRuntimePanel(
                  "results", ${data}, "${runtime}", true
                )'>
                <span class="glyphicon glyphicon-list-alt"></span>
              </button>
            </div>
          `);
        },
      },
    });
    tree.bind("loaded.jstree", function() {
      tree.jstree("open_all");
    });
    tree.unbind("dblclick.jstree").bind("dblclick.jstree", function(event) {
      const service = tree.jstree().get_node(event.target);
      showRuntimePanel("results", service.data.properties, runtime, true);
    });
  });
}

function displayResultsTable(service, runtime) {
  $("#result_table").remove();
  $(`#runtimes-result-${service.id}`).on("change", function() {
    tables[`result-${service.id}`].ajax.reload(null, false);
  });
  initTable(
    "result",
    service,
    runtime || currentRuntime,
    `result_table-${service.id}`
  );
}

function refreshLogs(service, runtime, editor, first, wasRefreshed) {
  if (!$(`#runtimes-logs-${service.id}`).length) return;
  call(`/get_service_logs/${service.id}/${runtime}`, function(result) {
    editor.setValue(result.logs);
    editor.setCursor(editor.lineCount(), 0);
    if (first || result.refresh) {
      setTimeout(
        () => refreshLogs(service, runtime, editor, false, result.refresh),
        1000
      );
    } else if (wasRefreshed) {
      $(`#runtime-logs-${service.id}`).remove();
      showRuntimePanel("results", service, runtime);
    }
  });
}

export const normalRun = (automation.normalRun = function(id) {
  call(`/run_service/${id}`, function(result) {
    runLogic(result);
  });
});

export function parameterizedRun(type, id) {
  fCall(`/run_service/${id}`, `edit-${type}-form-${id}`, function(result) {
    $(`#${type}-${id}`).remove();
    runLogic(result);
  });
}

export function runLogic(result) {
  showRuntimePanel("logs", result.service, result.runtime);
  notify(`Service '${result.service.name}' started.`, "success", 5);
  if (page == "workflow_builder" && workflow) {
    if (result.service.id != workflow.id) {
      getServiceState(result.service.id, true);
    }
  }
  $(`#${result.service.type}-${result.service.id}`).remove();
}

automation.exportService = function(id) {
  call(`/export_service/${id}`, () => {
    notify("Export successful.", "success", 5);
  });
};

automation.pauseTask = function(id) {
  call(`/task_action/pause/${id}`, function(result) {
    $(`#pause-resume-${id}`)
      .attr("onclick", `eNMS.automation.resumeTask('${id}')`)
      .text("Resume");
    notify("Task paused.", "success", 5);
  });
};

automation.resumeTask = function(id) {
  call(`/task_action/resume/${id}`, function() {
    $(`#pause-resume-${id}`)
      .attr("onclick", `eNMS.automation.pauseTask('${id}')`)
      .text("Pause");
    notify("Task resumed.", "success", 5);
  });
};

automation.field = function(name, type, id) {
  const fieldId = id ? `${type}-${name}-${id}` : `${type}-${name}`;
  return $(`#${fieldId}`);
};

automation.displayCalendar = function(calendarType) {
  showPanel("calendar", calendarType, () => {
    call(`/calendar_init/${calendarType}`, function(tasks) {
      let events = [];
      for (const [name, properties] of Object.entries(tasks)) {
        if (properties.service === undefined) continue;
        events.push({
          title: name,
          id: properties.id,
          description: properties.description,
          start: new Date(...properties.start),
          runtime: properties.runtime,
          service: properties.service,
        });
      }
      $("#calendar").fullCalendar({
        height: 600,
        header: {
          left: "prev,next today",
          center: "title",
          right: "month,agendaWeek,agendaDay,listMonth",
        },
        selectable: true,
        selectHelper: true,
        eventClick: function(e) {
          if (calendarType == "task") {
            showTypePanel("task", e.id);
          } else {
            showRuntimePanel("results", e.service, e.runtime);
          }
        },
        editable: true,
        events: events,
      });
    });
  });
};

automation.schedulerAction = function(action) {
  call(`/scheduler_action/${action}`, function() {
    notify(`Scheduler ${action}d.`, "success", 5);
  });
};

Object.assign(action, {
  Edit: (service) => showTypePanel(service.type, service.id),
  Duplicate: (service) => showTypePanel(service.type, service.id, "duplicate"),
  Run: (service) => normalRun(service.id),
  "Parameterized Run": (service) =>
    showTypePanel(service.type, service.id, "run"),
  Results: (service) => showRuntimePanel("results", service),
  Backward: () => switchToWorkflow(arrowHistory[arrowPointer - 1], "left"),
  Forward: () => switchToWorkflow(arrowHistory[arrowPointer + 1], "right"),
});

export function loadServiceTypes() {
  $("#service-type").selectpicker({ liveSearch: true });
  for (const [serviceType, serviceName] of Object.entries(serviceTypes)) {
    $("#service-type").append(new Option(serviceName, serviceType));
  }
  $("#service-type").selectpicker("refresh");
}
