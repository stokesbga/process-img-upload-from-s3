// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var util = require('util');
var sharp = require('sharp');

// get reference to S3 client
var s3 = new AWS.S3();

exports.handler = function(event, context, callback) {
    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    var srcBucket = event.Records[0].s3.bucket.name;
    
    const [env, targetBucket, basename] = (event.Records[0].s3.object.key).split('/');
    const uuid = basename.split(".")[0]
    
    // Object key may have spaces or unicode non-ASCII characters.
    const srcKey =
        decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    
    let dstBucket;
    if(targetBucket == 'profile') {
        dstBucket = "outfix-profile-images"
    } else if(targetBucket == 'collage'){
        dstBucket = "outfix-outfit-collage-images"
    }

    var dstKey = `${env}/${targetBucket}/${uuid}.jpg`;
    console.log("Variables from object key", env, targetBucket, uuid, srcKey);

    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        callback("Could not determine the image type.");
        return;
    }
    var imageType = typeMatch[1].toLowerCase();
    if (imageType != "jpg" && imageType != "png") {
        callback(`Unsupported image type: ${imageType}`);
        return;
    }

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
            // Download the image from S3 into a buffer.
            s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                },
                next);
            },
        function transform(response, next) {
            // set thumbnail width. Resize will set height automatically 
            // to maintain aspect ratio.
            var width = 1024;

            // Transform the image buffer in memory.
            sharp(response.Body)
               .resize(width)
                   .toBuffer("jpg", function(err, buffer) {
                        if (err) {
                            next(err);
                        } else {
                            next(null, response.ContentType, buffer);
                        }
                    });
        },
        function upload(contentType, data, next) {
            // Stream the transformed image to a different S3 bucket.
            s3.putObject({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: data,
                    ContentType: contentType
                },
                next);
            },
        function clean(response, next) {
            // Remove original image from tmp
            s3.deleteObject({
                Bucket: srcBucket,
                Key: srcKey
            }, next);
        },
        ], function (err) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
                    ' and upload to ' + dstBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + dstBucket + '/' + dstKey
                );
            }

            callback(null, "Error");
        }
    );
};
