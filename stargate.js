/*******************************/
// Main function on window load
/*******************************/
window.onload = function WindowLoad(event) {
  // Initialize State
  var state = {
    services: [
      {
        id: 1,
        name: "General Purpose EC2",
        type: "ec2",
        instance_type: "t2.micro",
        url_protocol: "ssh://",
        url_prefix: "ec2-user@",
        url_suffix: "",
        user_data: "",
        running_services: []
      },
      {
        id: 2,
        name: "R Studio",
        type: "ec2",
        instance_type: "t2.micro",
        user_data: btoa(`
        #!/bin/bash
        sudo amazon-linux-extras install docker
        sudo systemctl start docker
        sudo docker pull rocker/rstudio
        docker run -it -e PASSWORD=password -p 8787:8787 -d --rm rocker/rstudio
        `),
        url_protocol: "http://",
        url_prefix: "",
        url_suffix: ":8787",
        running_services: []
      }
    ],
    running_service_count: 0
  };

  // Setup Service List
  // TODO: variable should be "service" not "e" for clarity
  state["services"].forEach(function(service) {
    const service_item = `
    <li>
      <a id="service-` + service["id"] + `-link" href="">` + service["name"] + `</a> - Count: <span id="service-` + service["id"] + `-count">` + state["running_service_count"] + `</span></a>
      <ul id="service-` + service["id"] + `-list">
      </ul>
    </li>`;
    $("ul#service-list").append(service_item)
    $("a#service-" + service["id"] + "-link").click({state: state, service: service}, create_ec2_instance);
  });

  // Load AWS SDK
  AWS.config.update({
    credentials: new AWS.Credentials({
      accessKeyId: "",
      secretAccessKey: ""
    }),
    region: "us-east-1"
  });

  state["aws_ec2"] = new AWS.EC2({apiVersion: '2016-11-15'});

  load_instances_from_aws(state);
  // alert("You have " + state["running_service_count"] + " services running.");
};

/*******************************************************/
// Updates the services list based on describeInstances
/*******************************************************/
function load_instances_from_aws(state) {
  var params = {
    Filters: [
      {"Name": "tag:Stargate", "Values": ["true"]},
      {"Name": "instance-state-name", "Values": ["running"]}
    ],
    DryRun: false
  };

  state["aws_ec2"].describeInstances(params).promise().then(function(data) {
    console.log("Success", JSON.stringify(data));
    data["Reservations"].forEach(function(res) {
      res["Instances"].forEach(function(instance) {

      // Get instance Stargate ID and Service ID
      var instance_id = null;
      var service_id = null;
      instance["Tags"].forEach(function(tag) {
        if (tag["Key"] == "StargateServiceId") {
          service_id = tag["Value"];
        }
        if (tag["Key"] == "StargateId") {
          instance_id = tag["Value"];
        }
      });

      if (instance_id === null) {
        // Not a Stargate instance
        return
      }

      var service = null;
      state["services"].forEach(function(s) {
        if (s["id"] == service_id) {
          service = s;
        }
      });

      var instance_start_time = instance["LaunchTime"];
      var aws_instance_url = service["url_protocol"] + service["url_prefix"] + instance["PrivateDnsName"] + service["url_suffix"];
      var aws_instance_id = instance["InstanceId"];

      var instance_item = `
        <li id="` + instance_id + `-item">
          <span id="` + instance_id + `-status">Available at <a target="_blank" href="` + aws_instance_url + `">` + aws_instance_url + `</a></span> General Purpose EC2 - ID: ` + instance_id + ` Started At: ` + instance_start_time + `
        </li>
      `
      $("ul#service-" + service_id + "-list").append(instance_item);

      const new_instance = {
        instance_id: instance_id,
        url: aws_instance_url,
        start_time: instance_start_time,
        aws_id: aws_instance_id
      };
      service["running_services"].push(new_instance)

      state["running_service_count"] = state["running_service_count"] + 1;
      $("span#service-" + service["id"] + "-count").text(service["running_services"].length);
      });
    }),
    function(error) {
      console.log("Error: ", error, error.stack);
    }
  });
}

// e represents the HTML element that defines the service
// TODO: Use real variable names
function create_ec2_instance(event) {
  var service = event.data.service;
  var state = event.data.state;
  confirm("Are you sure you want to create a new instance of " + service["name"] + "?");
  const instance_number = state["running_service_count"] + 1
  const instance_id = "service-instance-" + instance_number;

  var instance_params = {
    ImageId: 'ami-009d6802948d06e52',
    InstanceType: 't2.micro',
    KeyName: '',
    MinCount: 1,
    MaxCount: 1,
    UserData: service["user_data"],
    SubnetId: '',
    'SecurityGroupIds': [''],
    'TagSpecifications': [{
          ResourceType: "instance",
          Tags: [
            {"Key": "Stargate", "Value": "true"},
            {"Key": "StargateId", "Value": "" + instance_number},
            {"Key": "StargateServiceId", "Value": "" + service["id"]},
            {"Key": "Name", "Value": service["name"] + "-" + instance_number}
          ]
    }]
  }

  var aws_ec2 = new AWS.EC2(
    {apiVersion: '2016-11-15'}
  );
  var instance_reservation = aws_ec2.runInstances(instance_params).promise();

  const instance_start_time = new Date();
  const initializing_service_item = `
    <li id="` + instance_id + `-item">
      <span id="` + instance_id + `-status">Initializing</span> ` + service["name"] + ` - ID: ` + instance_id + ` Started At: ` + instance_start_time + `
    </li>
  `
  $("ul#service-" + service["id"] + "-list").append(initializing_service_item);

  var aws_instance_id;

  instance_reservation.then(function(data) {
      console.log(data),
      aws_instance_id = data.Instances[0].InstanceId;
      console.log("Created instance ", aws_instance_id);
  });

  setTimeout(function() {
    const wait_for_params = {
      InstanceIds: [aws_instance_id],
      DryRun: false
    };

    aws_ec2.waitFor('instanceRunning', wait_for_params).promise().then(
      function(data) {
        console.log(data)
        var aws_instance_url = service["url_protocol"] +
                               service["url_prefix"] +
                               data.Reservations[0].Instances[0].PrivateDnsName +
                               service["url_suffix"];

        const new_instance = {
          instance_id: instance_id,
          url: aws_instance_url,
          start_time: instance_start_time,
          aws_id: aws_instance_id
        };
        service["running_services"].push(new_instance);
        state["running_service_count"] = instance_number;

        $("span#service-" + service["id"] + "-count").text(service["running_services"].length);

        $("span#" + instance_id + "-status").html("Available at <a target=\"_blank\" href=\"" + aws_instance_url + "\">" + aws_instance_url + "</a>");
      },
      function(error) {
        console.log(error, error.stack)
      });
  },
  5000);

  return false
}
